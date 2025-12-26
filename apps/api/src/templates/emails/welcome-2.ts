import { escapeHtml } from '../../lib/html';

export type Welcome2Params = {
  name?: string;
  gearUrl: string;
};

export function getWelcome2Subject(): string {
  return 'Why Loam Logger tracks wear at all';
}

export function getWelcome2Html(params: Welcome2Params): string {
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
    <h1>A quick bit of context</h1>

    <p>${greeting},</p>

    <p>
      One of the main reasons I started building Loam Logger was that bike maintenance lives in an awkward middle ground. It’s important, but it’s also easy to forget — especially if you ride a lot or rotate between bikes.
    </p>

    <p>
      Most riders don’t ignore maintenance because they don’t care. They ignore it because they don’t want to keep mental notes, spreadsheets, or reminders for every component on every bike.
    </p>

    <p>
      The goal with Loam Logger isn’t to make you think about service more. It’s to think about it less — and only surface something when it’s actually relevant.
    </p>

    <p>
      That’s why component wear exists in the app at all. Not as a checklist, and not as something you need to constantly manage, but as quiet context in the background while you ride.
    </p>

    <p>
      If and when you’re curious, the Gear section is where that information lives. You can add details there, or ignore it entirely until it matters.
    </p>

    <p>
      <a href="${params.gearUrl}" class="cta-button">View your gear</a>
    </p>

    <p>
      Over time, Loam Logger should feel less like a tracker and more like a safety net — something that has your back without asking for attention.
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
