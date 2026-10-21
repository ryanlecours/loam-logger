import { describe, it, expect } from 'vitest';
import { renderLanding } from './prerender-entry';

describe('renderLanding', () => {
  it('renders the landing page to static markup for crawlers', () => {
    const html = renderLanding();
    expect(html).toContain('Loam Logger tracks your bike');
    expect(html).toContain('<main class="lp">');
    expect(html).toContain('application/ld+json');
    expect(html).toContain('What does Free actually leave out?');
    // Links must be plain hrefs, not router-only handlers.
    expect(html).toContain('href="/signup"');
  });
});
