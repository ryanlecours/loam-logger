import { timingSafeEqual } from 'crypto';
import { Router, type Request, type Response } from 'express';
import type { SubscriptionProvider } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { config } from '../config/env';
import { storeToProvider } from '../lib/revenuecat';
import { upgradeUser, downgradeUser } from '../services/subscription.service';
import { sendEmailWithAudit } from '../services/email.service';
import { getPaymentFailedEmailHtml, getPaymentFailedEmailSubject, PAYMENT_FAILED_TEMPLATE_VERSION } from '../templates/emails/payment-failed';
import { captureServerEvent } from '../lib/posthog';

const router = Router();

function verifyWebhookAuth(authHeader: string | undefined): boolean {
  const expected = Buffer.from(`Bearer ${config.revenuecatWebhookAuthKey}`);
  const received = Buffer.from(authHeader ?? '');
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

router.post('/', async (req: Request, res: Response) => {
  // Verify authorization using constant-time comparison
  if (!verifyWebhookAuth(req.headers['authorization'] as string | undefined)) {
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
  // app_user_id is set to the Loam Logger user.id during SDK initialization
  // in the mobile app (src/lib/revenuecat.ts). This is the database primary key.
  const appUserId: string | undefined = event.app_user_id;
  const store: string | undefined = event.store;

  logger.info({ eventType, appUserId, store }, 'RevenueCat webhook received');

  // TRANSFER carries transferred_from / transferred_to instead of app_user_id,
  // so it is handled before the app_user_id check below.
  if (eventType === 'TRANSFER') {
    try {
      await handleTransfer(event, store);
    } catch (err) {
      logger.error({ error: err instanceof Error ? err.message : String(err), eventType }, 'Error processing RevenueCat webhook');
      res.status(500).json({ received: true, error: true });
      return;
    }
    res.status(200).json({ received: true });
    return;
  }

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
        if (eventType === 'INITIAL_PURCHASE') {
          // Mirrors the Stripe webhook's funnel terminus so IAP conversions
          // land in the same PostHog event. Financial fields are deliberately
          // excluded (privacy-policy scoped), matching the Stripe path.
          captureServerEvent(appUserId, 'subscription_checkout_completed', {
            source: 'revenuecat',
            store: store ?? 'unknown',
          });
        }
        break;
      }

      case 'EXPIRATION':
        await downgradeUser(appUserId, 'revenuecat_webhook');
        captureServerEvent(appUserId, 'subscription_canceled', {
          source: 'revenuecat',
          store: store ?? 'unknown',
        });
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

const IAP_PROVIDERS: SubscriptionProvider[] = ['APPLE', 'GOOGLE'];

/**
 * Keep only Loam user ids. Anonymous RevenueCat ids ($RCAnonymousID:...) never
 * match a Loam account, so they are dropped along with non-string entries.
 */
function loamUserIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const valid = ids.filter(
    (id): id is string => typeof id === 'string' && id.length > 0 && !id.startsWith('$RCAnonymousID:')
  );
  return [...new Set(valid)];
}

/**
 * A rider restored a store subscription while signed into a different Loam
 * account, so RevenueCat moved the purchases from transferred_from to
 * transferred_to. Upgrade the receiving accounts and downgrade the old ones,
 * but only where the old account's PRO came from an in-app purchase: founding
 * riders and Stripe subscribers keep PRO.
 */
async function handleTransfer(
  event: { transferred_from?: unknown; transferred_to?: unknown },
  store: string | undefined,
): Promise<void> {
  const toIds = loamUserIds(event.transferred_to);
  const fromIds = loamUserIds(event.transferred_from).filter((id) => !toIds.includes(id));

  logger.info({ transferredFrom: fromIds, transferredTo: toIds, store }, 'RevenueCat subscription transfer');

  let provider: 'APPLE' | 'GOOGLE';
  let downgradeProviders: SubscriptionProvider[];
  if (store) {
    provider = storeToProvider(store);
    downgradeProviders = [provider];
  } else {
    // store is optional on TRANSFER. Inherit the provider from the account the
    // purchases came from, and only touch that account's IAP-sourced PRO.
    logger.warn({ transferredFrom: fromIds, transferredTo: toIds }, 'RevenueCat TRANSFER missing store field');
    provider = (await sourceIapProvider(fromIds)) ?? storeToProvider('PLAY_STORE');
    downgradeProviders = IAP_PROVIDERS;
  }

  for (const userId of toIds) {
    await upgradeUser(userId, provider, 'revenuecat_webhook');
  }
  for (const userId of fromIds) {
    await downgradeUser(userId, 'revenuecat_webhook', { onlyProviders: downgradeProviders });
  }
}

async function sourceIapProvider(fromIds: string[]): Promise<'APPLE' | 'GOOGLE' | null> {
  if (fromIds.length === 0) return null;
  const source = await prisma.user.findFirst({
    where: { id: { in: fromIds }, subscriptionProvider: { in: IAP_PROVIDERS } },
    select: { subscriptionProvider: true },
  });
  const sourceProvider = source?.subscriptionProvider;
  return sourceProvider === 'APPLE' || sourceProvider === 'GOOGLE' ? sourceProvider : null;
}

async function handleBillingIssue(appUserId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: appUserId },
    select: { id: true, email: true, name: true },
  });

  if (!user) {
    logger.warn({ appUserId }, 'Billing issue for unknown user (RevenueCat app_user_id not found in DB)');
    return;
  }

  logger.warn({ userId: user.id }, 'IAP billing issue');

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
    logger.info({ userId: user.id }, 'Payment failed email already sent in last 24h, skipping');
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
    logger.error({ error: emailErr instanceof Error ? emailErr.message : String(emailErr), userId: user.id }, 'Failed to send payment failed email');
  }
}

export default router;
