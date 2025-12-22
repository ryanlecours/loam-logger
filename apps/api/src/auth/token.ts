import type { Request } from 'express';
import jwt from 'jsonwebtoken';

const { SESSION_SECRET } = process.env;

export type TokenPayload = {
  uid: string;
  email?: string;
};

/**
 * Generate a short-lived access token (15 minutes)
 * Used for authenticating mobile API requests
 */
export function generateAccessToken(payload: TokenPayload): string {
  if (!SESSION_SECRET) {
    throw new Error('SESSION_SECRET environment variable is not set');
  }
  return jwt.sign(payload, SESSION_SECRET, { expiresIn: '15m' });
}

/**
 * Generate a long-lived refresh token (7 days)
 * Used for obtaining new access tokens without re-authenticating
 */
export function generateRefreshToken(payload: TokenPayload): string {
  if (!SESSION_SECRET) {
    throw new Error('SESSION_SECRET environment variable is not set');
  }
  return jwt.sign(payload, SESSION_SECRET, { expiresIn: '7d' });
}

/**
 * Verify and decode a JWT token
 * Returns the payload if valid, null if invalid or expired
 */
export function verifyToken(token: string): TokenPayload | null {
  if (!SESSION_SECRET) {
    throw new Error('SESSION_SECRET environment variable is not set');
  }
  try {
    return jwt.verify(token, SESSION_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

/**
 * Extract bearer token from Authorization header
 * Returns the token string or null if not present or malformed
 *
 * Expected format: "Authorization: Bearer <token>"
 */
export function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;

  return parts[1];
}
