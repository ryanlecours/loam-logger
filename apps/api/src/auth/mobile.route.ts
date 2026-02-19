import express from 'express';
import { OAuth2Client } from 'google-auth-library';
import { ensureUserFromGoogle } from './ensureUserFromGoogle';
import { normalizeEmail } from './utils';
import { verifyPassword, validatePassword, hashPassword } from './password.utils';
import { generateAccessToken, generateRefreshToken, verifyToken } from './token';
import { updateLastAuthAt } from './recent-auth';
import { prisma } from '../lib/prisma';
import { checkMutationRateLimit } from '../lib/rate-limit';
import { sendPasswordAddedNotification, sendPasswordChangedNotification } from '../services/password-notification.service';
import { logger } from '../lib/logger';

const router = express.Router();

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;

const googleClient = new OAuth2Client({
  clientId: GOOGLE_CLIENT_ID,
  clientSecret: GOOGLE_CLIENT_SECRET,
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
    console.error('[MobileAuth] Google login failed', e);

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
    console.error('[MobileAuth] Apple login failed', e);
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
    console.error('[MobileAuth] Email login failed', e);
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
    console.error('[MobileAuth] Token refresh failed', e);
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
      return res.status(401).send('Unauthorized');
    }

    // Rate limit check
    const rateLimit = await checkMutationRateLimit('addPassword', sessionUser.uid);
    if (!rateLimit.allowed) {
      return res.status(429).json({
        error: 'Too many password attempts. Please try again later.',
        retryAfter: rateLimit.retryAfter,
      });
    }

    const { newPassword } = req.body as { newPassword?: string };

    if (!newPassword) {
      return res.status(400).send('Password is required');
    }

    // Validate password strength
    const validation = validatePassword(newPassword);
    if (!validation.isValid) {
      return res.status(400).send(validation.error || 'Password does not meet requirements');
    }

    // Get user with current state (for OAuth check and notification)
    const user = await prisma.user.findUnique({
      where: { id: sessionUser.uid },
      select: {
        id: true,
        email: true,
        accounts: {
          select: { provider: true },
        },
      },
    });

    if (!user) {
      return res.status(401).send('User not found');
    }

    // Verify at least one OAuth provider is linked
    if (user.accounts.length === 0) {
      return res.status(400).send('Cannot add password to this account type');
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
      return res.status(403).json({
        error: 'Account already has a password. Use change-password instead.',
        code: 'ALREADY_HAS_PASSWORD',
      });
    }

    // Send notification email (non-blocking)
    sendPasswordAddedNotification(user.id).catch(() => {
      // Already logged in the service
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('[MobileAuth] Add password failed', e);
    res.status(500).send('Failed to add password');
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
      return res.status(401).send('Unauthorized');
    }

    // Rate limit check
    const rateLimit = await checkMutationRateLimit('changePassword', sessionUser.uid);
    if (!rateLimit.allowed) {
      return res.status(429).json({
        error: 'Too many password change attempts. Please try again later.',
        retryAfter: rateLimit.retryAfter,
      });
    }

    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };

    if (!currentPassword || !newPassword) {
      return res.status(400).send('Current and new password are required');
    }

    // Validate new password strength
    const validation = validatePassword(newPassword);
    if (!validation.isValid) {
      return res.status(400).send(validation.error || 'Password does not meet requirements');
    }

    // Get user with current password hash
    const user = await prisma.user.findUnique({
      where: { id: sessionUser.uid },
      select: { id: true, passwordHash: true, mustChangePassword: true },
    });

    if (!user || !user.passwordHash) {
      return res.status(400).send('Cannot change password for this account');
    }

    // Verify current password
    const isValid = await verifyPassword(currentPassword, user.passwordHash);
    if (!isValid) {
      return res.status(401).send('Current password is incorrect');
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
    sendPasswordChangedNotification(user.id).catch(() => {
      // Already logged in the service
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('[MobileAuth] Change password failed', e);
    res.status(500).send('Failed to change password');
  }
});

export default router;
