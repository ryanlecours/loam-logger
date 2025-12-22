import { Router, type Request, type Response } from 'express';

const r = Router();

// A tiny HTML page to simulate Garmin's consent screen
const consentHtml = (redirectUrl: string) => `
<!doctype html><meta charset="utf-8">
<title>Mock Garmin Consent</title>
<div style="font-family:sans-serif;max-width:560px;margin:40px auto">
  <h2>Mock Garmin Authorization</h2>
  <p>This simulates Garmin's consent page. Click approve to continue.</p>
  <a href="${redirectUrl}" style="display:inline-block;padding:10px 16px;border:1px solid #ccc;border-radius:8px;text-decoration:none">Approve</a>
</div>
`;

// GET /mock/garmin/authorize?response_type=code&client_id=...&redirect_uri=...&state=...&code_challenge=...
r.get('/mock/garmin/authorize', (req: Request, res: Response) => {
  const { redirect_uri, state } = req.query as { redirect_uri?: string; state?: string };
  if (!redirect_uri) return res.status(400).send('missing redirect_uri');

  const code = `mockcode_${Date.now()}`;
  const back = new URL(redirect_uri);
  if (state) back.searchParams.set('state', state);
  back.searchParams.set('code', code);

  // Show a consent screen (clicking Approve redirects with code)
  return res.status(200).send(consentHtml(back.toString()));
});

// POST /mock/garmin/token (x-www-form-urlencoded)
r.post('/mock/garmin/token', async (req: Request, res: Response) => {
  // express.urlencoded must be enabled globally: app.use(express.urlencoded({ extended: false }))
  const grantType = (req.body?.grant_type as string) || 'authorization_code';

  if (grantType === 'authorization_code') {
    // Normally you'd verify code + PKCE. We just return tokens.
    return res.json({
      access_token: `mock_access_${Date.now()}`,
      refresh_token: `mock_refresh_${Date.now()}`,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: req.body?.scope ?? 'activity:read'
    });
  }

  if (grantType === 'refresh_token') {
    return res.json({
      access_token: `mock_access_${Date.now()}`,
      refresh_token: req.body?.refresh_token || `mock_refresh_${Date.now()}`,
      token_type: 'Bearer',
      expires_in: 3600
    });
  }

  return res.status(400).json({ error: 'unsupported_grant_type' });
});

// GET /mock/garmin/api/activities?limit=5
r.get('/mock/garmin/api/activities', (req: Request, res: Response) => {
  // Accept any Bearer token
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 5)));
  const now = Date.now();
  const mk = (i: number) => ({
    id: `mock-${i}`,
    startTime: new Date(now - i * 86400000).toISOString(),
    duration: 3600 + i * 123,     // seconds
    distance: 20000 + i * 321,    // meters
    elevationGain: 600 + i * 50,  // meters
  });
  const data = Array.from({ length: limit }, (_, i) => mk(i + 1));
  return res.json(data);
});

export default r;
