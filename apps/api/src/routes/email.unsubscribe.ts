import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyUnsubscribeToken } from '../lib/unsubscribe-token';

const router = Router();
const prisma = new PrismaClient();

/**
 * GET /api/email/unsubscribe?token=xxx
 *
 * One-click unsubscribe endpoint for email compliance (CAN-SPAM, GDPR).
 * No authentication required - uses signed JWT token for verification.
 */
router.get('/email/unsubscribe', async (req, res) => {
  const { token } = req.query;

  if (!token || typeof token !== 'string') {
    return res.status(400).send(getErrorPage('Missing or invalid token'));
  }

  const verified = verifyUnsubscribeToken(token);

  if (!verified) {
    return res.status(400).send(getErrorPage('Invalid or expired unsubscribe link'));
  }

  try {
    // Update user's email preference
    await prisma.user.update({
      where: { id: verified.userId },
      data: { emailUnsubscribed: true },
    });

    return res.status(200).send(getSuccessPage());
  } catch (error) {
    console.error('[Unsubscribe] Failed to update user:', error);
    return res.status(500).send(getErrorPage('Something went wrong. Please try again later.'));
  }
});

/**
 * Generate success confirmation HTML page
 */
function getSuccessPage(): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Unsubscribed - Loam Logger</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #1f2a1f;
      max-width: 480px;
      margin: 0 auto;
      padding: 40px 20px;
      background-color: #f6f1e8;
      text-align: center;
    }
    .container {
      background: #fffaf2;
      border: 1px solid #e3d6c6;
      border-radius: 16px;
      padding: 40px;
      box-shadow: 0 10px 22px rgba(31, 42, 31, 0.08);
    }
    .icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    h1 {
      color: #1f3d2a;
      margin: 0 0 12px;
      font-size: 24px;
    }
    p {
      color: #516055;
      margin: 0;
    }
    .brand {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid #e3d6c6;
      font-size: 14px;
      color: #6a746b;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">&#10003;</div>
    <h1>You've been unsubscribed</h1>
    <p>You won't receive any more emails from Loam Logger.</p>
    <div class="brand">Loam Logger</div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Generate error HTML page
 */
function getErrorPage(message: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Error - Loam Logger</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #1f2a1f;
      max-width: 480px;
      margin: 0 auto;
      padding: 40px 20px;
      background-color: #f6f1e8;
      text-align: center;
    }
    .container {
      background: #fffaf2;
      border: 1px solid #e3d6c6;
      border-radius: 16px;
      padding: 40px;
      box-shadow: 0 10px 22px rgba(31, 42, 31, 0.08);
    }
    .icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    h1 {
      color: #8b4513;
      margin: 0 0 12px;
      font-size: 24px;
    }
    p {
      color: #516055;
      margin: 0;
    }
    .brand {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid #e3d6c6;
      font-size: 14px;
      color: #6a746b;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">&#9888;</div>
    <h1>Something went wrong</h1>
    <p>${escapeHtml(message)}</p>
    <div class="brand">Loam Logger</div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Simple HTML escape for error messages
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export default router;
