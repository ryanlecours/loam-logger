import { escapeHtml } from '../../lib/html';

export type Welcome1Params = {
  name?: string;
  dashboardUrl: string;
};

export function getWelcome1Subject(): string {
  return 'A quick note as you get started';
}

export function getWelcome1Html(params: Welcome1Params): string {
  const safeName = params.name ? escapeHtml(params.name) : null;
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
      font-size: 24px;
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

    /* ---- Body ---- */
    p {
      margin: 12px 0;
    }

    a {
      color: #1f5f3b;
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
        <h1>Getting oriented</h1>
        <div class="subtitle">A quick note to make the first login feel easy.</div>
      </div>
    </div>

    <div class="trail-divider" aria-hidden="true"></div>

    <p>${greeting},</p>

    <p>
      When you log in for the first time, Loam Logger will ask you to add a bike. That’s intentional — everything else builds off of it.
    </p>

    <p>
      You don’t need to get it perfect.
    </p>
    <p>
      Adding the bike you ride most is enough to get started, and you can always fill in details later if and when they matter.
    </p>

    <p>
      From there, the app will guide you at a comfortable pace. There’s no checklist to complete and nothing you can mess up.
    </p>

    <div class="cta-wrap">
      <a href="${escapeHtml(params.dashboardUrl)}" class="cta-button">Open Loam Logger</a>
    </div>

    <p>
      Over time, Loam Logger works best when it quietly keeps track of things you’d rather not hold in your head — and only surfaces what’s relevant when it matters.
    </p>

    <p>
      If anything feels unclear or off, you can always reply directly to this email. Otherwise, enjoy getting familiar with it.
    </p>

    <p>
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
