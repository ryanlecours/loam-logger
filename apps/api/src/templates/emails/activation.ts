export type ActivationEmailParams = {
  name?: string;
  email: string;
  tempPassword: string;
  loginUrl: string;
};

export function getActivationEmailSubject(): string {
  return 'Your Loam Logger account is ready!';
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
    .warning {
      color: #92400e;
      font-weight: 500;
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
    <h1>Welcome to Loam Logger!</h1>

    <p>${greeting},</p>

    <p>Great news - your Loam Logger account has been activated! You can now start tracking your mountain bike maintenance and ride history.</p>

    <h2 style="color: #2d5a27; font-size: 18px;">Your Login Credentials</h2>

    <div class="credentials-box">
      <p><strong>Email:</strong> ${params.email}</p>
      <p><strong>Temporary Password:</strong> <span class="password-code">${params.tempPassword}</span></p>
    </div>

    <p class="warning"><strong>Important:</strong> You'll be prompted to change this password when you first log in.</p>

    <p>
      <a href="${params.loginUrl}" class="cta-button">Log In to Loam Logger</a>
    </p>

    <p>Once you're in, you can:</p>
    <ul>
      <li>Add your bikes to your garage</li>
      <li>Track component wear and service intervals</li>
      <li>Connect Strava or Garmin to sync rides automatically</li>
      <li>Log rides manually with GPX upload</li>
    </ul>

    <p>Questions? Just reply to this email and we'll help you out.</p>

    <p>Ride on!<br>The Loam Logger Team</p>

    <div class="footer">
      <p>You received this email because your Loam Logger beta access was approved. If you didn't request this, please ignore this email.</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}
