// Required env vars (set in Vercel project settings for prod):
//   VITE_POSTHOG_KEY   — Project API key from posthog.com, starts with `phc_`
//   VITE_POSTHOG_HOST  — Optional; defaults to https://us.i.posthog.com
import posthog from 'posthog-js';

let initialized = false;

// Email-shaped strings in any event property get redacted before send. Broad
// by design — false positives are cheap, a leaked email is not.
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const EMAIL_REDACTED = '[email]';

// Autocapture records click/change events with the element's visible text in
// `$el_text`. If a page ever renders the user's email/name as visible text
// (not inside an input — maskAllInputs doesn't apply here), that string
// lands in the event. Strip `$el_text` from autocaptures entirely rather
// than rely on per-element tagging; button labels in this app don't carry
// semantic meaning we can't recover from the CSS selector + attributes.
function sanitizeProperties(
  properties: Record<string, unknown>,
  eventName: string
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...properties };
  if (eventName === '$autocapture') {
    delete out.$el_text;
  }
  for (const k of Object.keys(out)) {
    const v = out[k];
    if (typeof v === 'string' && EMAIL_PATTERN.test(v)) {
      out[k] = v.replace(EMAIL_PATTERN, EMAIL_REDACTED);
    }
  }
  return out;
}

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
    // Opt specific elements out of autocapture by adding the `ph-no-capture`
    // class (PostHog's built-in opt-out marker — a defense-in-depth layer
    // beyond sanitize_properties below).
    // Pageviews are captured manually from React Router so SPA navigations
    // are tracked accurately. See usePostHogPageviews in App.tsx.
    capture_pageview: false,
    capture_pageleave: true,
    sanitize_properties: sanitizeProperties,
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
}

export { posthog };
