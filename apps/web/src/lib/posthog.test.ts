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
});
