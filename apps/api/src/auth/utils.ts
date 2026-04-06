import type { Request } from 'express';

export const normalizeEmail = (email?: string | null) =>
  (email ?? '').trim().toLowerCase() || null;

/** Relies on Express trust proxy being set (server.ts) so req.ip is the real client IP. */
export const getClientIp = (req: Request): string =>
  req.ip || 'unknown';

export const computeExpiry = (seconds?: number) =>
  seconds ? new Date(Date.now() + seconds * 1000) : null;
