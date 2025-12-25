export type Welcome3Params = {
  name?: string;
  settingsUrl: string;
};

export function getWelcome3Subject(): string {
  return 'Sync your rides automatically';
}

export function getWelcome3Html(params: Welcome3Params): string {
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
      font-size: 24px;
    }
    h2 {
      color: #2d5a27;
      font-size: 18px;
      margin-top: 24px;
    }
    .integration-card {
      display: flex;
      align-items: center;
      background: #f9fafb;
      padding: 16px;
      border-radius: 8px;
      margin: 12px 0;
      border: 1px solid #e5e7eb;
    }
    .integration-icon {
      font-size: 32px;
      margin-right: 16px;
    }
    .integration-info h3 {
      margin: 0 0 4px;
      font-size: 16px;
    }
    .integration-info p {
      margin: 0;
      color: #6b7280;
      font-size: 14px;
    }
    .feature-list {
      background: #f0f4f0;
      padding: 16px 20px;
      border-radius: 8px;
      margin: 20px 0;
    }
    .feature-list li {
      margin: 8px 0;
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
    <h1>Connect Your Fitness Apps</h1>

    <p>${greeting},</p>

    <p>The easiest way to use Loam Logger is to connect your existing fitness platform. Your rides sync automatically, and we'll track component hours for you.</p>

    <h2>Supported Integrations</h2>

    <div class="integration-card">
      <div class="integration-icon">🟠</div>
      <div class="integration-info">
        <h3>Strava</h3>
        <p>Sync rides, map gear to bikes, automatic hour tracking</p>
      </div>
    </div>

    <div class="integration-card">
      <div class="integration-icon">🔵</div>
      <div class="integration-info">
        <h3>Garmin Connect</h3>
        <p>Direct sync from your Garmin device or app</p>
      </div>
    </div>

    <div class="feature-list">
      <h3 style="margin-top: 0;">When you connect:</h3>
      <ul style="margin-bottom: 0; padding-left: 20px;">
        <li><strong>Rides sync automatically</strong> - no manual logging needed</li>
        <li><strong>Hours accumulate</strong> - track component wear passively</li>
        <li><strong>Gear mapping</strong> - match Strava gear to your Loam Logger bikes</li>
        <li><strong>Historical import</strong> - backfill your past rides</li>
      </ul>
    </div>

    <p>
      <a href="${params.settingsUrl}" class="cta-button">Connect an Integration</a>
    </p>

    <p>That wraps up our welcome series! You're all set to keep your bikes in peak condition.</p>

    <p>See you on the trails!<br>The Loam Logger Team</p>

    <div class="footer">
      <p>This is the last email in our welcome series. We'll only email you for important updates going forward.</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}
