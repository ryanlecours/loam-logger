import { escapeHtml } from '../../lib/html';

export type Welcome3Params = {
  name?: string;
  settingsUrl: string;
};

export function getWelcome3Subject(): string {
  return 'One last note';
}

export function getWelcome3Html(params: Welcome3Params): string {
  const safeName = params.name ? escapeHtml(params.name) : null;
  const greeting = safeName ? `Hi ${safeName}` : 'Hi there';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #1a1a1a;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f9fafb;
    }
    .container {
      background: white;
      border-radius: 12px;
      padding: 32px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    h1 {
      color: #2d5a27;
      margin-top: 0;
      font-size: 24px;
    }
    .cta-button {
      display: inline-block;
      background: #2d5a27;
      color: white !important;
      padding: 12px 24px;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      margin: 16px 0;
    }
    .footer {
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid #e5e7eb;
      color: #6b7280;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>A quick closing note</h1>

    <p>${greeting},</p>

    <p>
      This will be the last onboarding email from me.
    </p>

    <p>
      By now you’ve seen enough to get a feel for what Loam Logger is trying to be. Some riders dive in right away, others don’t really touch it until something needs attention. Both paths are completely normal.
    </p>

    <p>
      If it helps in the background, great. If you forget about it for a while and come back later, that’s exactly how it’s meant to work.
    </p>

    <p>
      Down the road, if you decide you want rides to sync automatically, you can connect Strava or Garmin anytime from your settings. There’s no setup you need to do now.
    </p>

    <p>
      <a href="${params.settingsUrl}" class="cta-button">View settings</a>
    </p>

    <p>
      I won’t keep emailing you about onboarding. From here on out, Loam Logger should quietly do its job and stay out of the way.
    </p>

    <p>
      If you ever have feedback, questions, or something just feels off, you can always reply directly to this email.
    </p>

    <p>
      Thanks again for being part of the early group.<br />
      — Ryan
    </p>

    <div class="footer">
      <p>
        You’re receiving this because you signed up for early access to Loam Logger.
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();
}
