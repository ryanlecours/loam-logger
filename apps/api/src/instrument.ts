import 'dotenv/config';
import * as Sentry from '@sentry/node';
import { scrubKnownSecrets } from './lib/sentry-scrub';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // Tag every event with the deploy SHA so Sentry can group errors by release
  // and surface regressions. Falls back to 'unknown' if the build didn't inject
  // it — prefer that over leaving it undefined, which disables release tracking.
  release: process.env.SENTRY_RELEASE || 'unknown',
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
  tracesSampleRate: 0.05,
  enabled: process.env.NODE_ENV === 'production',
  // Strip noisy health-check errors and scrub secrets from every event
  // (request bodies, breadcrumb data, contexts) before transmission.
  beforeSend(event) {
    const url = event.request?.url;
    if (url && (url.endsWith('/health') || url.endsWith('/healthz'))) return null;
    return scrubKnownSecrets(event);
  },
});
