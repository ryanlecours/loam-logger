import { escapeHtml } from '../../lib/html';

export const ANNOUNCEMENT_TEMPLATE_VERSION = '1.0.0';

export type AnnouncementEmailParams = {
  name?: string;
  subject: string;
  messageHtml: string;
  unsubscribeUrl: string;
};

export function getAnnouncementEmailSubject(subject: string): string {
  return subject;
}

export function getAnnouncementEmailHtml(params: AnnouncementEmailParams): string {
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

    /* ---- Body text ---- */
    p {
      margin: 12px 0;
    }

    a {
      color: #1f5f3b;
    }

    .message-content {
      margin: 20px 0;
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
        <h1>Loam Logger</h1>
        <div class="subtitle">An outdoor logbook for rides, bikes, and the stuff that wears out.</div>
      </div>
    </div>

    <div class="trail-divider" aria-hidden="true"></div>

    <p>${greeting},</p>

    <div class="message-content">
      ${params.messageHtml}
    </div>

    <p>
      — Ryan
    </p>

    <div class="footer">
      <p>
        You're receiving this because you signed up for early access to Loam Logger.
      </p>
      <p>
        <a href="${escapeHtml(params.unsubscribeUrl)}">Unsubscribe</a> from these emails.
      </p>
    </div>
  </div>
</body>
</html>
  `.trim();
}
