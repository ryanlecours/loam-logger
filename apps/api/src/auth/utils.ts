export const normalizeEmail = (email?: string | null) =>
  (email ?? '').trim().toLowerCase() || null;

export const computeExpiry = (seconds?: number) =>
  seconds ? new Date(Date.now() + seconds * 1000) : null;

export const isBetaTester = (email: string): boolean => {
  const betaTesterEmails = (process.env.BETA_TESTER_EMAILS ?? '')
    .split(',')
    .map((e) => normalizeEmail(e))
    .filter((e): e is string => e !== null);

  const normalizedEmail = normalizeEmail(email);
  return normalizedEmail ? betaTesterEmails.includes(normalizedEmail) : false;
};
