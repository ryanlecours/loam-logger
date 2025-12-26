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
    <h1>Getting oriented</h1>

    <p>${greeting},</p>

    <p>
      When you log in for the first time, Loam Logger will ask you to add a bike. That’s intentional — everything else builds off of it.
    </p>

    <p>
      You don’t need to get it perfect. Adding the bike you ride most is enough to get started, and you can always fill in details later if and when they matter.
    </p>

    <p>
      From there, the app will guide you at a comfortable pace. There’s no checklist to complete and nothing you can mess up.
    </p>

    <p>
      <a href="${params.dashboardUrl}" class="cta-button">Open Loam Logger</a>
    </p>

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
