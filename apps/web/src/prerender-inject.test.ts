import { describe, it, expect } from 'vitest';
import {
  applyRouteHead,
  buildGuard,
  GET_THE_APP_ROUTE,
  injectPrerendered,
  jsonLdString,
  LANDING_ROUTE,
  PRERENDER_GUARD,
  ROOT_MARKER,
  SIGNED_IN_PATH_PATTERN,
  SMART_BANNER_META,
} from './prerender-inject';

const injectLanding = (html: string, markup: string) => injectPrerendered(html, markup, LANDING_ROUTE);

const html =
  '<!doctype html><html><head><title>t</title>' +
  '<meta name="description" content="site description" />' +
  '<meta property="og:title" content="og title" />' +
  '<meta property="og:description" content="og description" />' +
  '<meta property="og:url" content="https://loamlogger.app/" />' +
  '<meta name="twitter:title" content="tw title" />' +
  '<meta name="twitter:description" content="tw description" />' +
  `</head><body>${ROOT_MARKER}<script src="/x.js"></script></body></html>`;
const filler = '<p>' + 'ride '.repeat(2000) + '</p>';
const markup = (inner: string) => `<main class="lp"><h1>Anyone can track a ride.</h1>${filler}${inner}</main>`;

/** The first regex the guard tests location.pathname against. */
function guardPathRegex(guard: string): RegExp {
  const test = guard.match(/if\(!(\/.*?\/)\.test\(location\.pathname\)\)/);
  expect(test).not.toBeNull();
  return new RegExp(test![1].slice(1, -1));
}

describe('injectLanding', () => {
  it('writes the markup inside #root and the guard before </head>', () => {
    const out = injectLanding(html, markup('<p>$39.99 a year</p>'));
    expect(out).toContain(`<div id="root"><main class="lp">`);
    expect(out).toContain('$39.99 a year');
    expect(out).toContain(`${PRERENDER_GUARD}</head>`);
    expect(out).not.toContain(ROOT_MARKER);
  });

  it('carries the Smart App Banner tag ahead of the guard that may remove it', () => {
    const out = injectLanding(html, markup(''));
    expect(out).toContain(`${SMART_BANNER_META}${PRERENDER_GUARD}</head>`);
    expect(SMART_BANNER_META).toContain('app-id=6761736134');
  });

  it('leaves the site-wide head alone, since index.html serves every route', () => {
    const out = injectLanding(html, markup(''));
    expect(out).toContain('<title>t</title>');
    expect(out).not.toContain('rel="canonical"');
  });

  it('keeps replacement patterns in the markup literal', () => {
    const tricky = "<p>$' $& $$ $1 $`</p>";
    const out = injectLanding(html, markup(tricky));
    expect(out).toContain(tricky);
  });

  it('refuses markup without the landing root, an h1, or enough content', () => {
    expect(() => injectLanding(html, `<div>${filler}</div>`)).toThrow(/main class="lp"/);
    expect(() => injectLanding(html, `<main class="lp">${filler}</main>`)).toThrow(/<h1>/);
    expect(() => injectLanding(html, '<main class="lp"><h1>x</h1></main>')).toThrow(/bytes/);
  });

  it('refuses to run twice on the same file, since the marker is consumed', () => {
    const once = injectLanding(html, markup(''));
    expect(() => injectLanding(once, markup(''))).toThrow(/could not find/);
  });

  it('refuses an index.html without the empty root marker', () => {
    expect(() => injectLanding('<html><head></head><body><div id="root">x</div></body></html>', markup(''))).toThrow(
      /could not find/,
    );
  });

  it('hides the root on every path except the homepage, with or without index.html', () => {
    expect(PRERENDER_GUARD).toContain('html.lp-prerendered #root{visibility:hidden}');
    const re = guardPathRegex(PRERENDER_GUARD);
    expect(re.test('/')).toBe(true);
    expect(re.test('/index.html')).toBe(true);
    expect(re.test('/dashboard')).toBe(false);
    expect(re.test('/pricing')).toBe(false);
    expect(re.test('/app')).toBe(false);
    expect(re.test('/index.html/')).toBe(false);
  });

  it('stops hiding the page if the bundle never mounts', () => {
    expect(PRERENDER_GUARD).toMatch(/setTimeout\(function\(\)\{document\.documentElement\.classList\.remove\("lp-prerendered"\)\},\d+\)/);
  });

  it('removes the Smart App Banner tag on the signed-in routes only', () => {
    expect(PRERENDER_GUARD).toContain(`if(/${SIGNED_IN_PATH_PATTERN}/.test(location.pathname))`);
    expect(PRERENDER_GUARD).toContain('meta[name="apple-itunes-app"]');
    const re = new RegExp(SIGNED_IN_PATH_PATTERN);
    for (const p of ['/dashboard', '/gear/abc', '/rides', '/bikes/1', '/settings', '/admin', '/onboarding/', '/auth/complete', '/reset-password']) {
      expect(re.test(p)).toBe(true);
    }
    for (const p of ['/', '/app', '/pricing', '/about', '/support', '/login', '/signup', '/gearbox', '/verify-email']) {
      expect(re.test(p)).toBe(false);
    }
  });

  it('refuses a path pattern that would break out of the inline regex or script', () => {
    expect(() => buildGuard('^/app$')).toThrow(/unescaped/);
    expect(() => buildGuard('^\\/app<\\/script>$')).toThrow(/must not contain "<"/);
    expect(() => buildGuard('^\\/app\\/?$')).not.toThrow();
  });
});

describe('injectPrerendered for /app', () => {
  const appMarkup = `<main class="lp"><h1>Loam Logger, in your pocket.</h1>${'<p>install </p>'.repeat(300)}</main>`;

  it('writes the page into its own copy of index.html with its own head', () => {
    const out = injectPrerendered(html, appMarkup, GET_THE_APP_ROUTE);
    expect(out).toContain('<div id="root"><main class="lp"><h1>Loam Logger, in your pocket.</h1>');
    expect(out).toContain(`<title>${GET_THE_APP_ROUTE.head!.title}</title>`);
    expect(out).toContain(`<meta name="description" content="${GET_THE_APP_ROUTE.head!.description}" />`);
    expect(out).toContain('<meta property="og:url" content="https://loamlogger.app/app" />');
    expect(out).toContain('<link rel="canonical" href="https://loamlogger.app/app" />');
    expect(out).toContain(SMART_BANNER_META);
    expect(out).not.toContain('og title');
  });

  it('treats /app, with or without a trailing slash, as the page itself', () => {
    const guard = buildGuard(GET_THE_APP_ROUTE.pathPattern);
    const re = guardPathRegex(guard);
    expect(re.test('/app')).toBe(true);
    expect(re.test('/app/')).toBe(true);
    expect(re.test('/app/index.html')).toBe(true);
    expect(re.test('/')).toBe(false);
    expect(re.test('/apple')).toBe(false);
    expect(re.test('/app/anything')).toBe(false);
  });

  it('accepts a shorter page than the landing but still refuses a broken one', () => {
    expect(appMarkup.length).toBeLessThan(8_000);
    expect(() => injectPrerendered(html, appMarkup, GET_THE_APP_ROUTE)).not.toThrow();
    expect(() => injectPrerendered(html, '<main class="lp"><h1>x</h1></main>', GET_THE_APP_ROUTE)).toThrow(/bytes/);
  });
});

describe('applyRouteHead', () => {
  const head = { title: 'A & "B" <C>', description: 'desc "quoted" & <tag>', canonical: 'https://loamlogger.app/x' };

  it('escapes the values for text and attribute contexts', () => {
    const out = applyRouteHead(html, head);
    expect(out).toContain('<title>A &amp; "B" &lt;C></title>');
    expect(out).toContain('content="desc &quot;quoted&quot; &amp; &lt;tag>"');
    expect(out).toContain('<link rel="canonical" href="https://loamlogger.app/x" />');
  });

  it('throws when index.html no longer carries a tag it expects to rewrite', () => {
    expect(() => applyRouteHead('<html><head><title>t</title></head><body></body></html>', head)).toThrow(/missing the head tag/);
  });
});

describe('jsonLdString', () => {
  it('keeps a closing script tag inside a value from ending the block', () => {
    const out = jsonLdString({ text: 'before </script><script>alert(1)</script>' });
    expect(out).not.toContain('</script>');
    expect(JSON.parse(out).text).toBe('before </script><script>alert(1)</script>');
  });
});
