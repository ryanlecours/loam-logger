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
        repeating-linear-gradient(
          0deg,
          rgba(45,90,39,0.05),
          rgba(45,90,39,0.05) 1px,
          rgba(0,0,0,0) 1px,
          rgba(0,0,0,0) 14px
        );
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
      background: radial-gradient(
        circle at 30% 30%,
        #3b7a3f 0%,
        #2d5a27 55%,
        #1f3d2a 100%
      );
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
        <h1>A quick bit of context</h1>
        <div class="subtitle">Why wear tracking exists — and why it stays quiet.</div>
      </div>
    </div>

    <div class="trail-divider" aria-hidden="true"></div>

    <p>${greeting},</p>

    <p>
      Most riders care about their bikes being in good working order.<br />
      What’s harder is knowing when something small needs attention.
    </p>

    <p>
      Without experience, maintenance intervals can feel vague or intimidating.<br />
      It’s easy to guess, put it off, or assume everything is fine.
    </p>

    <p>
      Even for experienced mechanics, it’s not simple.<br />
      Multiple bikes turn small services into spreadsheets, notes, or mental reminders that are easy to lose track of.
    </p>

    <p>
      Most days, we’re not trying to manage maintenance perfectly.<br />
      We’re just trying to get out for a ride after work.
    </p>

    <p>
      Loam Logger exists to help with that gap.<br />
      The goal is to surface small, inexpensive service needs before they turn into big, expensive problems.
    </p>

    <p>
      A fork lower service is a lot easier than a damaged damper.<br />
      Fresh brake pads are cheaper than a worn rotor.
    </p>

    <p>
      Wear tracking isn’t meant to turn you into a mechanic.<br />
      It’s meant to give you enough awareness to act early, without constant checking or guesswork.
    </p>

    <p>
      That information lives quietly in the background while you ride.<br />
      It only comes forward when something is actually worth paying attention to.
    </p>

    <p>
      If and when you’re curious, the Gear section is where that context lives.<br />
      You can add details there, or ignore it entirely until the moment it matters.
    </p>

    <div class="cta-wrap">
      <a href="${escapeHtml(params.gearUrl)}" class="cta-button">View your gear</a>
    </div>

    <p>
      Over time, Loam Logger should feel less like a tracker and more like a safety net.<br />
      Something that helps you catch the small stuff before it becomes a bigger issue.
    </p>

    <p>
      — Ryan
    </p>


    </div>
  </div>
</body>
</html>
  `.trim();
}
