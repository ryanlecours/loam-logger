import express from 'express';
import { OAuth2Client } from 'google-auth-library';
import { ensureUserFromGoogle } from './ensureUserFromGoogle';
import { normalizeEmail, isBetaTester } from './utils';
import { verifyPassword } from './password.utils';
import { generateAccessToken, generateRefreshToken, verifyToken } from './token';
import { prisma } from '../lib/prisma';

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

    // Handle beta tester access denial
    if (errorMessage === 'NOT_BETA_TESTER') {
      return res.status(403).send('NOT_BETA_TESTER');
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

    // Check beta tester access
    if (process.env.BETA_TESTER_EMAILS) {
      if (!isBetaTester(email)) {
        return res.status(403).send('NOT_BETA_TESTER');
      }
    }

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

export default router;
