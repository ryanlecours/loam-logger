import { describe, it, expect } from 'vitest';
import { renderLanding, renderRoute } from './prerender-entry';
import { PRERENDER_ROUTES } from './prerender-inject';

describe('renderLanding', () => {
  it('renders the landing page to static markup for crawlers', () => {
    const html = renderLanding();
    expect(html).toContain('Loam Logger tracks your bike');
    expect(html).toContain('<main class="lp">');
    expect(html).toContain('application/ld+json');
    expect(html).toContain('What does Free actually leave out?');
    // Links must be plain hrefs, not router-only handlers.
    expect(html).toContain('href="/signup"');
    expect(html).toContain('href="/app"');
  });
});

describe('renderRoute', () => {
  it('renders the /app page with both store links as plain hrefs', () => {
    const html = renderRoute('/app');
    expect(html).toContain('<main class="lp">');
    expect(html).toContain('<h1');
    expect(html).toContain('href="https://apps.apple.com/us/app/loam-logger/id6761736134"');
    expect(html).toContain('href="https://play.google.com/store/apps/details?id=com.loamlabs.loamlogger');
    expect(html).toContain('MobileApplication');
  });

  it('has a page for every route the build prerenders', () => {
    for (const route of PRERENDER_ROUTES) {
      expect(renderRoute(route.path).length).toBeGreaterThanOrEqual(route.minBytes);
    }
  });

  it('refuses a path nothing is registered for', () => {
    expect(() => renderRoute('/nope')).toThrow(/no page registered/);
  });
});
