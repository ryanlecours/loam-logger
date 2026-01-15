import express from 'express';
import { normalizeEmail } from './utils';
import { hashPassword, verifyPassword, validatePassword } from './password.utils';
import { validateEmailFormat } from './email.utils';
import { setSessionCookie } from './session';
import { setCsrfCookie } from './csrf'; // Used by /auth/csrf-token endpoint
import { prisma } from '../lib/prisma';
import { sendBadRequest, sendUnauthorized, sendForbidden, sendConflict, sendInternalError } from '../lib/api-response';

const router = express.Router();

/**
 * POST /auth/signup
 * Create a new user account with email and password
 */
router.post('/signup', express.json(), async (req, res) => {
  try {
    const { email: rawEmail, password, name } = req.body as {
      email?: string;
      password?: string;
      name?: string;
    };

    // Validate input
    if (!rawEmail || !password) {
      return sendBadRequest(res, 'Email and password are required');
    }

    if (!name || name.trim().length === 0) {
      return sendBadRequest(res, 'Name is required');
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
        // User is already on the waitlist
        return sendForbidden(res, 'You are already on the waitlist. We will email you when your account is activated.', 'ALREADY_ON_WAITLIST');
      }
      // User has an activated account
      return sendConflict(res, 'An account with this email already exists. Please log in.');
    }

    // Validate password before creating user
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      return sendBadRequest(res, passwordValidation.error || 'Invalid password');
    }

    // During closed beta, create user with WAITLIST role
    // They will be activated by admin and can then log in
    const passwordHash = await hashPassword(password);
    await prisma.user.create({
      data: {
        email,
        name: name.trim(),
        passwordHash,
        role: 'WAITLIST',
      },
    });

    // User is now on the waitlist - redirect to already-on-waitlist page
    return sendForbidden(res, 'You have been added to the waitlist. We will email you when your account is activated.', 'ALREADY_ON_WAITLIST');
  } catch (e) {
    console.error('[EmailAuth] Signup failed', e);
    return sendInternalError(res, 'Signup failed');
  }
});

/**
 * POST /auth/login
 * Authenticate user with email and password
 */
router.post('/login', express.json(), async (req, res) => {
  try {
    const { email: rawEmail, password } = req.body as {
      email?: string;
      password?: string;
    };

    // Validate input
    if (!rawEmail || !password) {
      return sendBadRequest(res, 'Email and password are required');
    }

    const email = normalizeEmail(rawEmail);
    if (!email) {
      return sendBadRequest(res, 'Invalid email');
    }

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        role: true,
        mustChangePassword: true,
      },
    });

    if (!user) {
      return sendUnauthorized(res, 'Invalid email or password');
    }

    // Block WAITLIST users - they cannot login until activated
    if (user.role === 'WAITLIST') {
      return sendForbidden(res, 'You are already on the waitlist. We will email you when your account is activated.', 'ALREADY_ON_WAITLIST');
    }

    // Check if user has a password (created via email/password signup)
    if (!user.passwordHash) {
      return sendUnauthorized(res, 'This account uses OAuth login only');
    }

    // Verify password
    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return sendUnauthorized(res, 'Invalid email or password');
    }

    // Set session and CSRF cookies, return CSRF token for immediate use
    setSessionCookie(res, { uid: user.id, email: user.email });
    const csrfToken = setCsrfCookie(res);

    // Return success with mustChangePassword flag and CSRF token
    res.status(200).json({
      ok: true,
      mustChangePassword: user.mustChangePassword,
      csrfToken,
    });
  } catch (e) {
    console.error('[EmailAuth] Login failed', e);
    return sendInternalError(res, 'Login failed');
  }
});

/**
 * POST /auth/change-password
 * Change password for authenticated user
 * Used after login with temporary password
 */
router.post('/change-password', express.json(), async (req, res) => {
  try {
    const sessionUser = req.sessionUser;
    if (!sessionUser?.uid) {
      return sendUnauthorized(res);
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
      return sendBadRequest(res, validation.error || 'Invalid password');
    }

    // Get user with current password hash
    const user = await prisma.user.findUnique({
      where: { id: sessionUser.uid },
      select: { passwordHash: true, mustChangePassword: true },
    });

    if (!user || !user.passwordHash) {
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

    res.json({ ok: true });
  } catch (e) {
    console.error('[EmailAuth] Change password failed', e);
    return sendInternalError(res, 'Failed to change password');
  }
});

/**
 * GET /auth/csrf-token
 * Get or refresh the CSRF token for authenticated sessions.
 * The token is returned in the response body and also set as a cookie.
 */
router.get('/csrf-token', (req, res) => {
  // Only provide CSRF token if user is authenticated via session cookie
  if (!req.sessionUser?.uid) {
    return sendUnauthorized(res, 'Authentication required');
  }

  // Set a new CSRF cookie and return the token
  const token = setCsrfCookie(res);
  res.json({ csrfToken: token });
});

export default router;
