import * as Sentry from "@sentry/react";
import React from "react";
import {
  useLocation,
  useNavigationType,
  createRoutesFromChildren,
  matchRoutes,
} from "react-router-dom";
import { scrubKnownSecrets } from "./lib/sentry-scrub";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  // Tag every event with the deploy SHA so Sentry can group errors by release
  // and bind uploaded source maps to the right build.
  release: import.meta.env.VITE_SENTRY_RELEASE || 'unknown',
  environment: import.meta.env.MODE,
  enabled: import.meta.env.PROD,

  integrations: [
    Sentry.reactRouterV7BrowserTracingIntegration({
      useEffect: React.useEffect,
      useLocation,
      useNavigationType,
      createRoutesFromChildren,
      matchRoutes,
    }),
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],

  // Tracing
  tracesSampleRate: 0.05,
  tracePropagationTargets: ["localhost", /^https:\/\/api\.loamlogger\.app/],

  // Session Replay
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  // Filter classic browser noise that isn't actionable.
  ignoreErrors: [
    // ResizeObserver loop warnings — harmless, fires on any dashboard with
    // charts responding to window resize.
    "ResizeObserver loop limit exceeded",
    "ResizeObserver loop completed with undelivered notifications",
    // Thrown non-Error values that Sentry normalizes into this cryptic message.
    "Non-Error promise rejection captured",
    // Browser extensions / ad blockers firing inside the page.
    /extension:\/\//,
  ],

  // Strip secret-looking keys (password, token, cookie, etc.) from every
  // event before it leaves the browser.
  beforeSend(event) {
    return scrubKnownSecrets(event);
  },
});
