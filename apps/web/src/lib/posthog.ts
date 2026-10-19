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

// `token` URL parameters are emailed credentials: a password reset link
// (/reset-password?token=), an email verification link
// (/verify-email?token=) or an account deletion link
// (/delete-account/confirm?token=). Pageviews send window.location.href, so
// without this the token would reach PostHog while it can still be redeemed.
// Same /g caveat as above.
const URL_TOKEN_PATTERN = /([?&#]token=)[^&#\s"']+/gi;
const URL_TOKEN_REDACTED = '$1[redacted]';

// Autocapture records the clicked element and its ancestors, by default with
// each element's visible text (`$el_text`, and `text=` in `$elements_chain`)
// and its attributes. Both carry rider data in this app: cards show a bike's
// name, and labels are built from it (`aria-label="Log service for <name>"`,
// a tile's `title`, a bike photo's `alt`). Dropping `$el_text` alone missed
// the chain, so drop all element text at the source and ignore the
// attributes that hold readable labels. Clicks are still identified by tag,
// classes, id, href and position. Dead-click capture keeps its own attribute
// ignorelist: it is off for this project, so give it this list if it is ever
// turned on.
export const AUTOCAPTURE_PRIVACY = {
  mask_all_text: true,
  autocapture: { element_attribute_ignorelist: ['aria-label', 'title', 'alt'] },
};

// Redact email-shaped strings and `token` URL parameters in every top-level
// string property, which includes `$current_url`, `$referrer` and
// `$elements_chain` (a `mailto:` href, for one).
export function sanitizeProperties(properties: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...properties };
  for (const k of Object.keys(out)) {
    const v = out[k];
    if (typeof v === 'string') {
      const redacted = v
        .replace(EMAIL_PATTERN, EMAIL_REDACTED)
        .replace(URL_TOKEN_PATTERN, URL_TOKEN_REDACTED);
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
    ...AUTOCAPTURE_PRIVACY,
    // Opt specific elements out of autocapture by adding the `ph-no-capture`
    // class (PostHog's built-in opt-out marker — a defense-in-depth layer
    // beyond AUTOCAPTURE_PRIVACY and sanitize_properties).
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
