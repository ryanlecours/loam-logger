import { config } from '../config/env';
import { logger } from './logger';

export function validateRevenueCatConfig(): void {
  if (!config.revenuecatWebhookAuthKey) {
    throw new Error('Missing REVENUECAT_WEBHOOK_AUTH_KEY env var');
  }
}

/** Map RevenueCat store identifiers to our SubscriptionProvider enum */
export function storeToProvider(store: string): 'APPLE' | 'GOOGLE' {
  if (store === 'APP_STORE' || store === 'MAC_APP_STORE') return 'APPLE';
  if (store !== 'PLAY_STORE') {
    logger.warn({ store }, 'Unknown RevenueCat store, defaulting to GOOGLE');
  }
  return 'GOOGLE';
}
