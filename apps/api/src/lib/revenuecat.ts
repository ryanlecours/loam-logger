import { config } from '../config/env';

export function validateRevenueCatConfig(): void {
  if (!config.revenuecatWebhookAuthKey) {
    throw new Error('Missing REVENUECAT_WEBHOOK_AUTH_KEY env var');
  }
}

/** Map RevenueCat store identifiers to our SubscriptionProvider enum */
export function storeToProvider(store: string): 'APPLE' | 'GOOGLE' {
  if (store === 'APP_STORE' || store === 'MAC_APP_STORE') return 'APPLE';
  return 'GOOGLE';
}
