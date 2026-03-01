/**
 * Renders an HTML page that deep-links the user back to the mobile app
 * after an OAuth callback completes. Used by both Garmin and Strava routes.
 */
export function renderOAuthCompletionPage(params: {
  provider: string;
  status: string;
  reason?: string;
  scheme: string;
  brandColor: string;
}): string {
  const { provider, status, reason, scheme, brandColor } = params;

  const deepLinkPath = `${scheme}://oauth/${provider.toLowerCase()}`;
  const queryParams = new URLSearchParams({ status });
  if (reason) queryParams.set('reason', reason);
  const deepLinkUrl = `${deepLinkPath}?${queryParams.toString()}`;

  const isSuccess = status === 'success';
  const title = isSuccess
    ? `${provider} Connected!`
    : `${provider} Connection Failed`;
  const message = isSuccess
    ? `Your ${provider} account has been connected to Loam Logger.`
    : `Something went wrong connecting your ${provider} account.${reason ? ` (${reason})` : ''}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="2;url=${deepLinkUrl}" />
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: #f5f5f5;
      color: #333;
      padding: 24px;
    }
    .card {
      background: #fff;
      border-radius: 16px;
      padding: 40px 32px;
      text-align: center;
      max-width: 400px;
      width: 100%;
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 22px; margin-bottom: 8px; color: ${brandColor}; }
    p { font-size: 15px; color: #666; margin-bottom: 24px; line-height: 1.5; }
    .btn {
      display: inline-block;
      background: ${brandColor};
      color: #fff;
      padding: 14px 32px;
      border-radius: 8px;
      text-decoration: none;
      font-size: 16px;
      font-weight: 600;
    }
    .sub { font-size: 13px; color: #999; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${isSuccess ? '&#10003;' : '&#10007;'}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <a class="btn" href="${deepLinkUrl}">Return to Loam Logger</a>
    <p class="sub">You should be redirected automatically&hellip;</p>
  </div>
  <script>
    window.location.href = ${JSON.stringify(deepLinkUrl)};
  </script>
</body>
</html>`;
}
