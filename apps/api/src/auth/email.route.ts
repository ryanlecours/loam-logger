import express from 'express';
import { normalizeEmail, isBetaTester } from './utils';
import { hashPassword, verifyPassword, validatePassword } from './password.utils';
import { validateEmailFormat } from './email.utils';
import { setSessionCookie } from './session';
import { prisma } from '../lib/prisma';

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
      return res.status(400).send('Email and password are required');
    }

    if (!name || name.trim().length === 0) {
      return res.status(400).send('Name is required');
    }

    const email = normalizeEmail(rawEmail);
    if (!email) {
      return res.status(400).send('Invalid email');
    }

    if (!validateEmailFormat(email)) {
      return res.status(400).send('Invalid email format');
    }

    // Validate password strength
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      return res.status(400).send(passwordValidation.error);
    }

    // Check beta tester access
    if (process.env.BETA_TESTER_EMAILS) {
      if (!isBetaTester(email)) {
        return res.status(403).send('NOT_BETA_TESTER');
      }
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name: name.trim(),
        onboardingCompleted: false,
      },
    });

    // Set session cookie
    setSessionCookie(res, { uid: user.id, email: user.email });
    res.status(200).json({ ok: true });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[EmailAuth] Signup failed', e);

    // Check if email already exists
    if (error.includes('Unique constraint failed')) {
      return res.status(409).send('Email already in use');
    }

    res.status(500).send('Signup failed');
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

    // Check beta tester access
    if (process.env.BETA_TESTER_EMAILS) {
      if (!isBetaTester(email)) {
        return res.status(403).send('NOT_BETA_TESTER');
      }
    }

    // Set session cookie
    setSessionCookie(res, { uid: user.id, email: user.email });
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[EmailAuth] Login failed', e);
    res.status(500).send('Login failed');
  }
});

export default router;
