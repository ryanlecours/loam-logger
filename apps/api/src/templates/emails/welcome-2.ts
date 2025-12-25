export type Welcome2Params = {
  name?: string;
  gearUrl: string;
};

export function getWelcome2Subject(): string {
  return 'Pro tip: Track your component wear';
}

export function getWelcome2Html(params: Welcome2Params): string {
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
    .highlight-box {
      background: linear-gradient(135deg, #f0f4f0 0%, #e8ede8 100%);
      padding: 20px;
      border-radius: 8px;
      margin: 20px 0;
      border-left: 4px solid #2d5a27;
    }
    .service-intervals {
      background: #fefce8;
      padding: 16px 20px;
      border-radius: 8px;
      margin: 16px 0;
    }
    .service-intervals h3 {
      margin-top: 0;
      color: #854d0e;
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
    <h1>Never Miss a Service Again</h1>

    <p>${greeting},</p>

    <p>Did you know that regular fork and shock service can extend their life by years and keep your ride feeling fresh?</p>

    <div class="highlight-box">
      <p><strong>Loam Logger tracks ride hours automatically</strong> and alerts you when components are due for service based on manufacturer recommendations.</p>
    </div>

    <h2>Typical Service Intervals</h2>

    <div class="service-intervals">
      <h3>Suspension</h3>
      <ul style="margin: 0;">
        <li><strong>Fork lowers service:</strong> Every 50 hours</li>
        <li><strong>Full fork rebuild:</strong> Every 100-200 hours</li>
        <li><strong>Shock service:</strong> Every 100-200 hours</li>
      </ul>
    </div>

    <div class="service-intervals">
      <h3>Drivetrain</h3>
      <ul style="margin: 0;">
        <li><strong>Chain:</strong> Every 500-1000 miles (check with tool)</li>
        <li><strong>Cassette:</strong> Every 2-3 chains</li>
        <li><strong>Brake pads:</strong> Check monthly, varies by riding</li>
      </ul>
    </div>

    <p>Set up your service intervals in your Garage to get automatic reminders:</p>

    <p>
      <a href="${params.gearUrl}" class="cta-button">Set Up Service Intervals</a>
    </p>

    <p>Ride safe!<br>The Loam Logger Team</p>

    <div class="footer">
      <p>You're receiving this as part of our welcome series. Reply if you have questions!</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}
