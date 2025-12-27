import { escapeHtml } from '../../lib/html';

export type ActivationEmailParams = {
  name?: string;
  email: string;
  tempPassword: string;
  loginUrl: string;
};

export function getActivationEmailSubject(): string {
  return 'Welcome — Your Loam Logger access is ready';
}

export function getActivationEmailHtml(params: ActivationEmailParams): string {
  const safeName = params.name ? escapeHtml(params.name) : null;
  const safeEmail = escapeHtml(params.email);
  const safeTempPassword = escapeHtml(params.tempPassword);
  const greeting = safeName ? `Hi ${safeName}` : 'Hi there';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    /* ---- Base ---- */
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.65;
      color: #1f2a1f;
      max-width: 640px;
      margin: 0 auto;
      padding: 22px;
      background-color: #f6f1e8;
      /* subtle “field notes” texture (email-safe) */
      background-image:
        linear-gradient(0deg, rgba(255,255,255,0.55), rgba(255,255,255,0.55)),
        repeating-linear-gradient(0deg, rgba(45,90,39,0.05), rgba(45,90,39,0.05) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 14px);
    }

    .container {
      background: #fffaf2;
      border: 1px solid #e3d6c6;
      border-radius: 16px;
      padding: 34px;
      /* less fintech “card shadow”, more paper lift */
      box-shadow: 0 10px 22px rgba(31, 42, 31, 0.08);
    }

    /* ---- Header ---- */
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 10px;
    }

    .mark {
      width: 38px;
      height: 38px;
      border-radius: 12px;
      background: radial-gradient(circle at 30% 30%, #3b7a3f 0%, #2d5a27 55%, #1f3d2a 100%);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.25);
      display: inline-block;
    }

    h1 {
      color: #1f3d2a;
      margin: 0;
      font-size: 26px;
      letter-spacing: -0.2px;
    }

    .subtitle {
      margin: 6px 0 18px;
      color: #516055;
      font-size: 14px;
    }

    .trail-divider {
      height: 10px;
      margin: 18px 0 22px;
      border-radius: 999px;
      background:
        repeating-linear-gradient(
          90deg,
          rgba(45,90,39,0.18) 0,
          rgba(45,90,39,0.18) 10px,
          rgba(133,77,14,0.18) 10px,
          rgba(133,77,14,0.18) 20px
        );
      opacity: 0.75;
    }

    /* ---- Body text ---- */
    p {
      margin: 12px 0;
    }

    /* ---- Credentials ---- */
    h2 {
      color: #1f3d2a;
      font-size: 16px;
      margin: 26px 0 10px;
      letter-spacing: 0.1px;
      text-transform: none;
    }

    .credentials-box {
      background: #eef4ec;
      border: 1px solid #cfe0cf;
      border-radius: 12px;
      margin: 16px 0 18px;
      padding: 18px 18px 16px;
      border-left: 6px solid #2d5a27;
    }

    .credentials-top {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
      color: #1f3d2a;
      font-weight: 700;
    }

    .tiny {
      color: #516055;
      font-size: 13px;
      margin-top: 2px;
    }

    .credentials-box p {
      margin: 8px 0;
    }

    a {
      color: #1f5f3b;
    }

    .password-code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
      background: rgba(31, 61, 42, 0.08);
      border: 1px solid rgba(31, 61, 42, 0.15);
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 13px;
      display: inline-block;
    }

    /* ---- CTA ---- */
    .cta-wrap {
      margin: 18px 0 14px;
    }

    .cta-button {
      display: inline-block;
      background: linear-gradient(180deg, #2f6a35 0%, #214a25 100%);
      color: #ffffff !important;
      padding: 14px 22px;
      text-decoration: none;
      border-radius: 999px;
      font-weight: 700;
      letter-spacing: 0.2px;
      box-shadow: 0 10px 18px rgba(33, 74, 37, 0.22);
      border: 1px solid rgba(31, 61, 42, 0.25);
    }

    .cta-button:hover {
      filter: brightness(0.98);
    }

    /* ---- Footer ---- */
    .footer {
      margin-top: 30px;
      padding-top: 16px;
      border-top: 1px solid #eadfce;
      color: #6a746b;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="brand">
      <span class="mark" aria-hidden="true"></span>
      <div>
        <h1>Welcome to Loam Logger</h1>
        <div class="subtitle">An outdoor logbook for rides, bikes, and the stuff that wears out.</div>
      </div>
    </div>

    <div class="trail-divider" aria-hidden="true"></div>

    <p>${greeting},</p>

    <p>
      Thank you for raising your hand early.
    </p>

    <p>
      I am building Loam Logger slowly and deliberately, and the people who help shape it at the beginning really matter.
    </p>

    <p>
      Because you are part of this first group, you have been added as a <strong>Founding Rider</strong>.<br /><br />That means you have free access for life — no paywalls, no expiration, no strings attached.
    </p>

    <p>
      Use it as much or as little as you want. If it’s useful, great. If it’s not yet, that’s okay too.
    </p>

    <p>
      The goal right now is simply to make something that genuinely helps riders stay on top of their bikes.
    </p>

    <h2>Your login details</h2>

    <div class="credentials-box">
      <div class="credentials-top">🔧 Account details</div>
      <p><strong>Email:</strong> ${safeEmail}</p>
      <p><strong>Temporary password:</strong> <span class="password-code">${safeTempPassword}</span></p>
      <p class="tiny">You will be prompted to change this password the first time you log in.</p>
    </div>

    <div class="cta-wrap">
      <a href="${params.loginUrl}" class="cta-button">Log in to Loam Logger</a>
    </div>

    <p>
      Once you’re in, you can add your bikes, connect Garmin or Strava, and start tracking maintenance in whatever way feels natural. There’s no setup you have to rush through.
    </p>

    <p>
      If you ever have feedback — good, bad, or indifferent — just reply to this email. And if you’d rather just ride and never think about it, that’s completely fine too.
    </p>

    <p>
      Thanks again for being here.<br />
      — Ryan
    </p>

    <div class="footer">
      <p>
        You’re receiving this email because you signed up for early access to Loam Logger. If this landed in your inbox by mistake, feel free to ignore it.
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();
}
