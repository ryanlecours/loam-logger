// Which browser origins may call the API with credentials.
//
// Every allowed origin can send a signed-in rider's session cookie (it is
// SameSite=None in production) and read the response, including the CSRF
// token from GET /auth/csrf-token. So the list holds exact origins we control,
// never a pattern on a shared hosting domain: anyone can deploy to
// *.vercel.app, and a <project>.vercel.app name goes to whoever claims it
// first, so even a suffix like our team slug can be registered by someone
// else. Preview deployments that need the API are listed one by one in
// CORS_EXTRA_ORIGINS.

/** Local RN/Expo dev servers (http only). */
const LOCAL_DEV_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:8081',
  'http://localhost:19000',
  'http://localhost:19006',
];

/** CORS_EXTRA_ORIGINS: a comma-separated list of exact origins. */
export function parseExtraOrigins(raw: string | undefined): string[] {
  return (raw || '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

export function createOriginAllowlist(opts: {
  frontendUrl: string;
  extraOrigins: string[];
}): (origin?: string) => boolean {
  const allowed = new Set([opts.frontendUrl.replace(/\/$/, ''), ...LOCAL_DEV_ORIGINS, ...opts.extraOrigins]);

  return (origin?: string) => {
    if (!origin) return true; // SSR/tools/no Origin header

    // Expo/custom schemes. Browsers never send these, so they cannot be used
    // to borrow a rider's cookie.
    if (origin.startsWith('exp://') || origin.startsWith('loamlogger://')) return true;

    return allowed.has(origin);
  };
}
