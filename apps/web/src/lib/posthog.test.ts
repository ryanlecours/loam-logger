import { describe, it, expect } from 'vitest';
import { AUTOCAPTURE_PRIVACY, sanitizeProperties } from './posthog';

describe('AUTOCAPTURE_PRIVACY', () => {
  it('drops element text from clicks', () => {
    expect(AUTOCAPTURE_PRIVACY.mask_all_text).toBe(true);
  });

  it('ignores the attributes that carry readable labels', () => {
    // These are built from rider data, e.g. aria-label="Log service for <bike name>".
    expect(AUTOCAPTURE_PRIVACY.autocapture.element_attribute_ignorelist).toEqual(
      expect.arrayContaining(['aria-label', 'title', 'alt'])
    );
  });
});

describe('sanitizeProperties', () => {
  it('redacts emails anywhere in a string property, including the elements chain', () => {
    const out = sanitizeProperties({
      $elements_chain: 'a:href="mailto:rider@example.com"nth-child="1"',
      note: 'contact rider@example.com or other@example.org',
    });
    expect(out.$elements_chain).toBe('a:href="mailto:[email]"nth-child="1"');
    expect(out.note).toBe('contact [email] or [email]');
  });

  it('leaves other values untouched', () => {
    const props = { $current_url: 'https://loamlogger.app/gear', count: 3 };
    expect(sanitizeProperties(props)).toEqual(props);
  });

  it('redacts emailed tokens in URLs, keeping the rest of the URL', () => {
    const out = sanitizeProperties({
      $current_url: 'https://loamlogger.app/delete-account/confirm?token=eyJhbGci.payload.sig',
      $referrer: 'https://loamlogger.app/reset-password?token=abc123&source=email',
      later: 'https://loamlogger.app/x?a=1&token=t0k#frag',
    });
    expect(out.$current_url).toBe('https://loamlogger.app/delete-account/confirm?token=[redacted]');
    expect(out.$referrer).toBe('https://loamlogger.app/reset-password?token=[redacted]&source=email');
    expect(out.later).toBe('https://loamlogger.app/x?a=1&token=[redacted]#frag');
  });

  it('leaves parameters that merely end in "token" alone', () => {
    const props = { $current_url: 'https://loamlogger.app/x?csrftoken=keep' };
    expect(sanitizeProperties(props)).toEqual(props);
  });

  it('redacts the provider failure message on /auth/error', () => {
    const out = sanitizeProperties({
      $current_url:
        'https://loamlogger.app/auth/error?message=Strava%20connection%20failed.%20Please%20try%20again.',
      $referrer: 'https://loamlogger.app/auth/error?message=x&section=data-sources',
    });
    expect(out.$current_url).toBe('https://loamlogger.app/auth/error?message=[redacted]');
    expect(out.$referrer).toBe('https://loamlogger.app/auth/error?message=[redacted]&section=data-sources');
  });
});
