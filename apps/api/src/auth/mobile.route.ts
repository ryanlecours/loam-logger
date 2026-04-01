import express from 'express';
import { OAuth2Client } from 'google-auth-library';
import { ensureUserFromGoogle } from './ensureUserFromGoogle';
import { normalizeEmail } from './utils';
import { validateEmailFormat } from './email.utils';
import { verifyPassword, validatePassword, hashPassword } from './password.utils';
import { generateAccessToken, generateRefreshToken, verifyToken } from './token';
import { updateLastAuthAt } from './recent-auth';
import { prisma } from '../lib/prisma';
import { checkAuthRateLimit, checkMutationRateLimit } from '../lib/rate-limit';
import { sendPasswordAddedNotification, sendPasswordChangedNotification } from '../services/password-notification.service';
import { logger } from '../lib/logger';
import { sendUnauthorized, sendBadRequest, sendForbidden, sendConflict, sendInternalError, sendTooManyRequests } from '../lib/api-response';
import { config } from '../config/env';
import { createNewUser } from '../services/signup.service';

const router = express.Router();

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;

const googleClient = new OAuth2Client({
  clientId: GOOGLE_CLIENT_ID,
  clientSecret: GOOGLE_CLIENT_SECRET,
});

/**
 * POST /auth/mobile/signup
 * Register new user from mobile app (closed beta - adds to waitlist)
 * Returns JSON response indicating waitlist status
 */
router.post('/mobile/signup', express.json(), async (req, res) => {
  try {
    // Rate limit by IP to prevent automated spam signups
    const clientIp = req.ip || (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 'unknown';
    const rateLimit = await checkAuthRateLimit('signup', clientIp);
    if (!rateLimit.allowed) {
      return sendTooManyRequests(res, 'Too many signup attempts. Please try again later.', rateLimit.retryAfter);
    }

    const { email: rawEmail, password, name, ref } = req.body as {
      email?: string;
      password?: string;
      name?: string;
      ref?: string;
    };

    // Validate email
    if (!rawEmail) {
      return sendBadRequest(res, 'Email is required');
    }

    const email = normalizeEmail(rawEmail);
    if (!email) {
      return sendBadRequest(res, 'Invalid email');
    }

    if (!validateEmailFormat(email)) {
      return sendBadRequest(res, 'Invalid email format');
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { role: true },
    });

    if (existingUser) {
      if (existingUser.role === 'WAITLIST') {
        return sendForbidden(
          res,
          'You are already on the waitlist. We will email you when your account is activated.',
          'ALREADY_ON_WAITLIST'
        );
      }
      return sendConflict(res, 'An account with this email already exists. Please log in.');
    }

    // During closed beta, create user with WAITLIST role
    // Password is optional during signup - will be set during activation
    let passwordHash = null;
    if (password) {
      const validation = validatePassword(password);
      if (!validation.isValid) {
        return sendBadRequest(res, validation.error || 'Password does not meet requirements');
      }
      passwordHash = await hashPassword(password);
    }

    const trimmedName = name?.trim() || null;
    if (trimmedName && trimmedName.length > 100) {
      return sendBadRequest(res, 'Name must be 100 characters or fewer');
    }

    if (config.bypassWaitlistFlow) {
      if (!passwordHash) {
        return sendBadRequest(res, 'Password is required');
      }

      const { user } = await createNewUser({ email, name: trimmedName, passwordHash, ref, signupIp: clientIp });

      const accessToken = generateAccessToken({ uid: user.id, email: user.email });
      const refreshToken = generateRefreshToken({ uid: user.id, email: user.email });

      return res.status(201).json({
        ok: true,
        waitlist: false,
        accessToken,
        refreshToken,
      });
    }

    // Waitlist flow
    await createNewUser({ email, name: trimmedName, passwordHash, ref, signupIp: clientIp });

    return res.status(200).json({
      ok: true,
      waitlist: true,
      message: 'You have been added to the waitlist. We will email you when your account is activated.',
    });
  } catch (e) {
    logger.error({ err: e }, '[MobileAuth] Signup failed');
    return sendInternalError(res, 'Signup failed');
  }
});

/**
 * POST /auth/mobile/google
 * Authenticate mobile user with Google ID token
 * Returns access token and refresh token for mobile app
 */
router.post('/mobile/google', express.json(), async (req, res) => {
  try {
    const { idToken } = req.body as { idToken?: string };
    if (!idToken) {
      return res.status(400).send('Missing idToken');
    }

    // Verify the Google ID token
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub) {
      return res.status(401).send('Invalid Google token');
    }

    // Create or update user
    const user = await ensureUserFromGoogle({
      sub: payload.sub,
      email: payload.email ?? undefined,
      email_verified: payload.email_verified,
      name: payload.name,
      picture: payload.picture,
    });

    // Update last auth timestamp for recent-auth gating (non-blocking)
    updateLastAuthAt(user.id).catch((err) =>
      logger.error({ err, userId: user.id }, '[MobileAuth] Failed to update lastAuthAt')
    );

    // Generate tokens for mobile
    const accessToken = generateAccessToken({ uid: user.id, email: user.email });
    const refreshToken = generateRefreshToken({ uid: user.id, email: user.email });

    res.status(200).json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    logger.error({ err: e }, '[MobileAuth] Google login failed');

    // Handle closed beta - new users
    if (errorMessage === 'CLOSED_BETA') {
      return res.status(403).send('CLOSED_BETA');
    }
    // Handle waitlist users trying to login
    if (errorMessage === 'ALREADY_ON_WAITLIST') {
      return res.status(403).send('ALREADY_ON_WAITLIST');
    }

    res.status(500).send('Authentication failed');
  }
});

/**
 * POST /auth/mobile/apple
 * Authenticate mobile user with Apple ID token
 * Returns access token and refresh token for mobile app
 *
 * Note: This is a placeholder for Apple Sign-In.
 * Full implementation requires Apple Sign-In credentials and verification logic.
 */
router.post('/mobile/apple', express.json(), async (req, res) => {
  try {
    const { identityToken } = req.body as { identityToken?: string };
    if (!identityToken) {
      return res.status(400).send('Missing identityToken');
    }

    // TODO: Implement Apple ID token verification
    // This requires:
    // 1. Fetch Apple's public keys from https://appleid.apple.com/auth/keys
    // 2. Verify JWT signature using Apple's public key
    // 3. Validate claims (iss, aud, exp)
    // 4. Extract user information (sub, email, email_verified)

    res.status(501).send('Apple Sign-In not yet implemented');
  } catch (e) {
    logger.error({ err: e }, '[MobileAuth] Apple login failed');
    res.status(500).send('Authentication failed');
  }
});

/**
 * POST /auth/mobile/login
 * Authenticate mobile user with email and password
 * Returns access token and refresh token for mobile app
 */
router.post('/mobile/login', express.json(), async (req, res) => {
  try {
    const { email: rawEmail, password } = req.body as {
      email?: string;
      password?: string;
    };

    // Validate input
    if (!rawEmail || !password) {
      return res.status(400).send('Email and password are required');
    }

    const email = normalizeEmail(rawEmail);
    if (!email) {
      return res.status(400).send('Invalid email');
    }

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(401).send('Invalid email or password');
    }

    // Check if user has a password (created via email/password signup)
    if (!user.passwordHash) {
      return res.status(401).send('This account uses OAuth login only');
    }

    // Verify password
    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).send('Invalid email or password');
    }

    // Block WAITLIST users - they cannot login until activated
    if (user.role === 'WAITLIST') {
      return res.status(403).send('ALREADY_ON_WAITLIST');
    }

    // Update last auth timestamp for recent-auth gating (non-blocking)
    updateLastAuthAt(user.id).catch((err) =>
      logger.error({ err, userId: user.id }, '[MobileAuth] Failed to update lastAuthAt')
    );

    // Generate tokens for mobile
    const accessToken = generateAccessToken({ uid: user.id, email: user.email });
    const refreshToken = generateRefreshToken({ uid: user.id, email: user.email });

    res.status(200).json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (e) {
    logger.error({ err: e }, '[MobileAuth] Email login failed');
    res.status(500).send('Login failed');
  }
});

/**
 * POST /auth/mobile/refresh
 * Refresh access token using refresh token
 * Returns new access token
 *
 * Note: Token refresh does NOT update lastAuthAt - it doesn't prove fresh authentication.
 */
router.post('/mobile/refresh', express.json(), async (req, res) => {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken) {
      return res.status(400).send('Missing refreshToken');
    }

    // Verify refresh token
    const payload = verifyToken(refreshToken);
    if (!payload) {
      return res.status(401).send('Invalid or expired refresh token');
    }

    // Verify user still exists
    const user = await prisma.user.findUnique({
      where: { id: payload.uid },
    });

    if (!user) {
      return res.status(401).send('User not found');
    }

    // Generate new access token
    const accessToken = generateAccessToken({ uid: user.id, email: user.email });

    res.status(200).json({ accessToken });
  } catch (e) {
    logger.error({ err: e }, '[MobileAuth] Token refresh failed');
    res.status(500).send('Token refresh failed');
  }
});

/**
 * POST /auth/mobile/password/add
 * Add password to OAuth-only account (mobile)
 *
 * Mobile access tokens are short-lived (15 min), so if the token is valid,
 * the auth is "recent" by definition. No separate recent-auth check needed.
 */
router.post('/mobile/password/add', express.json(), async (req, res) => {
  try {
    const sessionUser = req.sessionUser;
    if (!sessionUser?.uid) {
      return sendUnauthorized(res);
    }

    // Rate limit check
    const rateLimit = await checkMutationRateLimit('addPassword', sessionUser.uid);
    if (!rateLimit.allowed) {
      return sendTooManyRequests(
        res,
        'Too many password attempts. Please try again later.',
        rateLimit.retryAfter
      );
    }

    const { newPassword } = req.body as { newPassword?: string };

    if (!newPassword) {
      return sendBadRequest(res, 'Password is required');
    }

    // Validate password strength
    const validation = validatePassword(newPassword);
    if (!validation.isValid) {
      return sendBadRequest(res, validation.error || 'Password does not meet requirements');
    }

    // Get user with current state (for OAuth check and notification)
    const user = await prisma.user.findUnique({
      where: { id: sessionUser.uid },
      select: {
        id: true,
        email: true,
        name: true,
        accounts: {
          select: { provider: true },
        },
      },
    });

    if (!user) {
      // User ID from valid token doesn't exist in DB - data integrity issue
      return sendInternalError(res, 'Failed to add password');
    }

    // Verify at least one OAuth provider is linked
    if (user.accounts.length === 0) {
      return sendBadRequest(res, 'Cannot add password to this account type');
    }

    // Hash password before atomic update
    const passwordHash = await hashPassword(newPassword);

    // Atomic conditional update: only set passwordHash if it's currently null
    // This prevents TOCTOU race conditions where concurrent requests could
    // both pass a null-check before either write completes
    const result = await prisma.user.updateMany({
      where: { id: user.id, passwordHash: null },
      data: { passwordHash },
    });

    // If no rows updated, user already has a password
    if (result.count === 0) {
      return sendForbidden(
        res,
        'Account already has a password. Use change-password instead.',
        'ALREADY_HAS_PASSWORD'
      );
    }

    // Send notification email (non-blocking)
    sendPasswordAddedNotification({ id: user.id, email: user.email, name: user.name }).catch(() => {
      // Already logged in the service
    });

    res.json({ ok: true });
  } catch (e) {
    logger.error({ err: e }, '[MobileAuth] Add password failed');
    return sendInternalError(res, 'Failed to add password');
  }
});

/**
 * POST /auth/mobile/password/change
 * Change password for authenticated user (mobile)
 *
 * Mobile access tokens are short-lived (15 min), so if the token is valid,
 * the auth is "recent" by definition. No separate recent-auth check needed.
 */
router.post('/mobile/password/change', express.json(), async (req, res) => {
  try {
    const sessionUser = req.sessionUser;
    if (!sessionUser?.uid) {
      return sendUnauthorized(res);
    }

    // Rate limit check
    const rateLimit = await checkMutationRateLimit('changePassword', sessionUser.uid);
    if (!rateLimit.allowed) {
      return sendTooManyRequests(
        res,
        'Too many password change attempts. Please try again later.',
        rateLimit.retryAfter
      );
    }

    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };

    if (!currentPassword || !newPassword) {
      return sendBadRequest(res, 'Current and new password are required');
    }

    // Validate new password strength
    const validation = validatePassword(newPassword);
    if (!validation.isValid) {
      return sendBadRequest(res, validation.error || 'Password does not meet requirements');
    }

    // Get user with current password hash and info for notification
    const user = await prisma.user.findUnique({
      where: { id: sessionUser.uid },
      select: { id: true, email: true, name: true, passwordHash: true, mustChangePassword: true },
    });

    if (!user) {
      // User ID from valid token doesn't exist in DB - data integrity issue
      return sendInternalError(res, 'Failed to change password');
    }

    if (!user.passwordHash) {
      return sendBadRequest(res, 'Cannot change password for this account');
    }

    // Verify current password
    const isValid = await verifyPassword(currentPassword, user.passwordHash);
    if (!isValid) {
      return sendUnauthorized(res, 'Current password is incorrect');
    }

    // Hash and save new password, clear mustChangePassword flag
    const newHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: sessionUser.uid },
      data: {
        passwordHash: newHash,
        mustChangePassword: false,
      },
    });

    // Send notification email (non-blocking)
    sendPasswordChangedNotification({ id: user.id, email: user.email, name: user.name }).catch(() => {
      // Already logged in the service
    });

    res.json({ ok: true });
  } catch (e) {
    logger.error({ err: e }, '[MobileAuth] Change password failed');
    return sendInternalError(res, 'Failed to change password');
  }
});

export default router;
