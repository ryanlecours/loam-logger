export type Welcome1Params = {
  name?: string;
  dashboardUrl: string;
};

export function getWelcome1Subject(): string {
  return 'Getting started with Loam Logger';
}

export function getWelcome1Html(params: Welcome1Params): string {
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
    .tip-box {
      background: #f0f4f0;
      padding: 16px 20px;
      border-radius: 8px;
      margin: 16px 0;
    }
    .tip-number {
      display: inline-block;
      background: #2d5a27;
      color: white;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      text-align: center;
      line-height: 24px;
      font-weight: 600;
      font-size: 14px;
      margin-right: 8px;
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
    <h1>Quick Start Guide</h1>

    <p>${greeting},</p>

    <p>Welcome to Day 1 with Loam Logger! Here are three quick tips to get the most out of your account.</p>

    <h2>Get Started in 5 Minutes</h2>

    <div class="tip-box">
      <p><span class="tip-number">1</span> <strong>Add Your First Bike</strong></p>
      <p style="margin-left: 32px;">Head to your Garage and add your primary bike. Include the manufacturer, model, and year to unlock insights.</p>
    </div>

    <div class="tip-box">
      <p><span class="tip-number">2</span> <strong>Track Key Components</strong></p>
      <p style="margin-left: 32px;">Add your fork, shock, and drivetrain. We'll track hours and remind you when service is due.</p>
    </div>

    <div class="tip-box">
      <p><span class="tip-number">3</span> <strong>Log Your Last Ride</strong></p>
      <p style="margin-left: 32px;">Manually log your most recent ride or upload a GPX file. This helps establish your riding patterns.</p>
    </div>

    <p>
      <a href="${params.dashboardUrl}" class="cta-button">Open Dashboard</a>
    </p>

    <p>In a few days, I'll show you how to connect Strava or Garmin for automatic ride syncing.</p>

    <p>Happy trails!<br>The Loam Logger Team</p>

    <div class="footer">
      <p>You're receiving this as part of our welcome series. Reply if you have questions!</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}
