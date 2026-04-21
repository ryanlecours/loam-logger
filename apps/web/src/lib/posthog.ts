// Required env vars (set in Vercel project settings for prod):
//   VITE_POSTHOG_KEY   — Project API key from posthog.com, starts with `phc_`
//   VITE_POSTHOG_HOST  — Optional; defaults to https://us.i.posthog.com
import posthog from 'posthog-js';

let initialized = false;

export function initPostHog(): void {
  if (initialized) return;
  initialized = true;

  const key = import.meta.env.VITE_POSTHOG_KEY;
  const host = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com';
  if (!key || !import.meta.env.PROD) return;

  posthog.init(key, {
    api_host: host,
    persistence: 'localStorage+cookie',
    autocapture: true,
    // Pageviews are captured manually from React Router so SPA navigations
    // are tracked accurately. See usePostHogPageviews in App.tsx.
    capture_pageview: false,
    capture_pageleave: true,
    session_recording: {
      // Default-deny: every <input>, <textarea>, and <select> is masked in
      // replays unless we add an explicit allowlist later via maskInputFn.
      // Future form fields don't silently leak PII just because nobody
      // remembered to tag them. If a specific input must be visible
      // (public-facing, non-PII), add a maskInputFn exception here.
      maskAllInputs: true,
      // Non-input text that needs masking (e.g. a rendered email address or
      // reset token in the DOM) can be tagged with data-ph-mask.
      maskTextSelector: '[data-ph-mask]',
    },
    // Replay sample rate (10% / 100% on error) is set in the PostHog project
    // settings dashboard, not here — the SDK respects the server config.
  });
  initialized = true;
}

export { posthog };
