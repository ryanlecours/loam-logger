export const normalizeEmail = (email?: string | null) =>
  (email ?? '').trim().toLowerCase() || null;

export const computeExpiry = (seconds?: number) =>
  seconds ? new Date(Date.now() + seconds * 1000) : null;
