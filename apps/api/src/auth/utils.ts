import type { Request } from 'express';

export const normalizeEmail = (email?: string | null) =>
  (email ?? '').trim().toLowerCase() || null;

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/**
 * Fold an address to the inbox it delivers to, for duplicate detection only.
 *
 * Gmail ignores dots in the local part and treats googlemail.com as gmail.com,
 * and most providers deliver `name+anything@` to `name@`. Without folding, one
 * inbox can open any number of accounts. A + in the first position is kept,
 * since there is no base address before it. The stored and sign-in email stay
 * as the rider typed them; this value only lives in User.emailCanonical.
 *
 * The migration that added emailCanonical backfills it with the same rules in
 * SQL; keep the two in step.
 */
export function canonicalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf('@');
  if (at <= 0) return normalized;

  let local = normalized.slice(0, at);
  let domain = normalized.slice(at + 1);

  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);

  if (GMAIL_DOMAINS.has(domain)) {
    domain = 'gmail.com';
    local = local.replace(/\./g, '');
  }

  return local ? `${local}@${domain}` : normalized;
}

/** Relies on Express trust proxy being set (server.ts) so req.ip is the real client IP. */
export const getClientIp = (req: Request): string =>
  req.ip || 'unknown';

/** User agent for signup forensics, capped so a hostile header can't bloat the row. */
export const getUserAgent = (req: Request): string | null =>
  req.get('user-agent')?.slice(0, 512) || null;

export const computeExpiry = (seconds?: number) =>
  seconds ? new Date(Date.now() + seconds * 1000) : null;
