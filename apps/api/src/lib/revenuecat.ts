import { logger } from './logger';

/** Map RevenueCat store identifiers to our SubscriptionProvider enum */
export function storeToProvider(store: string): 'APPLE' | 'GOOGLE' {
  if (store === 'APP_STORE' || store === 'MAC_APP_STORE') return 'APPLE';
  if (store !== 'PLAY_STORE') {
    logger.warn({ store }, 'Unknown RevenueCat store, defaulting to GOOGLE');
  }
  return 'GOOGLE';
}
