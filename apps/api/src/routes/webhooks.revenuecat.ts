import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { config } from '../config/env';
import { storeToProvider } from '../lib/revenuecat';
import { upgradeUser, downgradeUser } from '../services/subscription.service';
import { sendEmailWithAudit } from '../services/email.service';
import { getPaymentFailedEmailHtml, getPaymentFailedEmailSubject, PAYMENT_FAILED_TEMPLATE_VERSION } from '../templates/emails/payment-failed';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  // Verify authorization
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${config.revenuecatWebhookAuthKey}`) {
    logger.warn('RevenueCat webhook: invalid authorization');
    res.status(401).send('Unauthorized');
    return;
  }

  const event = req.body?.event;
  if (!event) {
    res.status(400).send('Missing event');
    return;
  }

  const eventType: string = event.type;
  const appUserId: string | undefined = event.app_user_id;
  const store: string | undefined = event.store;

  logger.info({ eventType, appUserId, store }, 'RevenueCat webhook received');

  if (!appUserId) {
    logger.warn({ eventType }, 'RevenueCat webhook missing app_user_id');
    res.status(200).json({ received: true });
    return;
  }

  try {
    switch (eventType) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'UNCANCELLATION': {
        if (!store) {
          logger.warn({ eventType, appUserId }, 'RevenueCat webhook missing store field');
        }
        const provider = storeToProvider(store || 'PLAY_STORE');
        await upgradeUser(appUserId, provider, 'revenuecat_webhook');
        break;
      }

      case 'EXPIRATION':
        await downgradeUser(appUserId, 'revenuecat_webhook');
        break;

      case 'BILLING_ISSUE':
        await handleBillingIssue(appUserId);
        break;

      case 'CANCELLATION':
        // User cancelled but still has access until period end. Log only.
        logger.info({ appUserId, store }, 'Subscription cancelled (access continues until period end)');
        break;

      case 'PRODUCT_CHANGE':
        // Monthly ↔ yearly switch. No tier change needed.
        logger.info({ appUserId, store, newProductId: event.new_product_id }, 'Subscription product changed');
        break;

      case 'SUBSCRIBER_ALIAS':
        logger.warn({ appUserId, aliases: event.aliases }, 'RevenueCat subscriber alias event — investigate if unexpected');
        break;

      default:
        logger.info({ eventType, appUserId }, 'Unhandled RevenueCat event type');
    }
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err), eventType, appUserId }, 'Error processing RevenueCat webhook');
    res.status(500).json({ received: true, error: true });
    return;
  }

  res.status(200).json({ received: true });
});

async function handleBillingIssue(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true },
  });

  if (!user) {
    logger.warn({ userId }, 'Billing issue for unknown user');
    return;
  }

  logger.warn({ userId }, 'IAP billing issue');

  // Dedup: only send one payment_failed email per 24-hour window per user
  const recentEmail = await prisma.emailSend.findFirst({
    where: {
      userId: user.id,
      emailType: 'payment_failed',
      status: 'sent',
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    select: { id: true },
  });

  if (recentEmail) {
    logger.info({ userId }, 'Payment failed email already sent in last 24h, skipping');
    return;
  }

  try {
    const firstName = user.name?.split(' ')[0] || undefined;
    await sendEmailWithAudit({
      to: user.email,
      subject: getPaymentFailedEmailSubject(),
      html: await getPaymentFailedEmailHtml({ name: firstName }),
      userId: user.id,
      emailType: 'payment_failed',
      triggerSource: 'revenuecat_webhook',
      templateVersion: PAYMENT_FAILED_TEMPLATE_VERSION,
      bypassUnsubscribe: true,
    });
  } catch (emailErr) {
    logger.error({ error: emailErr instanceof Error ? emailErr.message : String(emailErr), userId }, 'Failed to send payment failed email');
  }
}

export default router;
