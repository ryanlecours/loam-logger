// Required env vars (set in Vercel project settings for prod):
//   VITE_POSTHOG_KEY   — Project API key from posthog.com, starts with `phc_`
//   VITE_POSTHOG_HOST  — Optional; defaults to https://us.i.posthog.com
import posthog from 'posthog-js';

let initialized = false;

// Email-shaped strings in any event property get redacted before send. Broad
// by design — false positives are cheap, a leaked email is not.
//
// NB: The /g flag matters for replace() (catch every occurrence in one pass)
// but a /g regex carries lastIndex state across calls — using the same
// instance for both .test() and .replace() would cause alternating hits and
// misses on successive string props. We skip the pre-test and call replace
// directly: if there's no match, replace returns the input string unchanged,
// which is effectively the same work as test() would do anyway.
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
    if (typeof v === 'string') {
      const redacted = v.replace(EMAIL_PATTERN, EMAIL_REDACTED);
      if (redacted !== v) out[k] = redacted;
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
    // $pageleave's listener fires on every pushState in a SPA, so the
    // resulting counts don't mean "user left the app" — they mean "user
    // navigated within the app." Misleading enough that we'd rather not
    // have the metric at all. If we ever need true session-end signal,
    // plumb it through `beforeunload` with an explicit event name.
    capture_pageleave: false,
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
