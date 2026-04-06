import type { Request } from 'express';

export const normalizeEmail = (email?: string | null) =>
  (email ?? '').trim().toLowerCase() || null;

export const getClientIp = (req: Request): string =>
  req.ip || (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 'unknown';

export const computeExpiry = (seconds?: number) =>
  seconds ? new Date(Date.now() + seconds * 1000) : null;
