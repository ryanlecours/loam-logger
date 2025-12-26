export type ActivationEmailParams = {
  name?: string;
  email: string;
  tempPassword: string;
  loginUrl: string;
};

export function getActivationEmailSubject(): string {
  return 'Welcome — your Loam Logger access is ready';
}

export function getActivationEmailHtml(params: ActivationEmailParams): string {
  const greeting = params.name ? `Hi ${params.name}` : 'Hi there';

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
    }
    .credentials-box {
      background: #f0f4f0;
      padding: 20px;
      border-radius: 8px;
      margin: 24px 0;
      border-left: 4px solid #2d5a27;
    }
    .credentials-box p {
      margin: 8px 0;
    }
    .password-code {
      font-family: 'SF Mono', Monaco, 'Courier New', monospace;
      background: #e8ede8;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 14px;
    }
    .cta-button {
      display: inline-block;
      background: #2d5a27;
      color: white !important;
      padding: 14px 28px;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      margin: 16px 0;
    }
    .cta-button:hover {
      background: #234a1f;
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
    <h1>Welcome to Loam Logger</h1>

    <p>${greeting},</p>

    <p>
      Thanks for raising your hand early. I’m building Loam Logger slowly and deliberately, and the people who help shape it at the beginning really matter.
    </p>

    <p>
      Because you are part of this first group, you’ve been added as a <strong>Founding Rider</strong>. That means you have free access for life — no paywalls, no expiration, no strings attached.
    </p>

    <p>
      Use it as much or as little as you want. If it’s useful, great. If it’s not yet, that’s okay too. The goal right now is simply to make something that genuinely helps riders stay on top of their bikes.
    </p>

    <h2 style="color: #2d5a27; font-size: 18px;">Your login details</h2>

    <div class="credentials-box">
      <p><strong>Email:</strong> ${params.email}</p>
      <p><strong>Temporary password:</strong> <span class="password-code">${params.tempPassword}</span></p>
    </div>

    <p>
      You’ll be prompted to change this password the first time you log in.
    </p>

    <p>
      <a href="${params.loginUrl}" class="cta-button">Log in to Loam Logger</a>
    </p>

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
