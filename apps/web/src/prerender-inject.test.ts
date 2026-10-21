import { describe, it, expect } from 'vitest';
import { injectLanding, PRERENDER_GUARD, ROOT_MARKER } from './prerender-inject';

const html = `<!doctype html><html><head><title>t</title></head><body>${ROOT_MARKER}<script src="/x.js"></script></body></html>`;
const filler = '<p>' + 'ride '.repeat(2000) + '</p>';
const markup = (inner: string) => `<main class="lp"><h1>Anyone can track a ride.</h1>${filler}${inner}</main>`;

describe('injectLanding', () => {
  it('writes the markup inside #root and the guard before </head>', () => {
    const out = injectLanding(html, markup('<p>$39.99 a year</p>'));
    expect(out).toContain(`<div id="root"><main class="lp">`);
    expect(out).toContain('$39.99 a year');
    expect(out).toContain(`${PRERENDER_GUARD}</head>`);
    expect(out).not.toContain(ROOT_MARKER);
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

  it('refuses an index.html without the empty root marker', () => {
    expect(() => injectLanding('<html><head></head><body><div id="root">x</div></body></html>', markup(''))).toThrow(
      /could not find/,
    );
  });

  it('hides the root on every path except "/"', () => {
    expect(PRERENDER_GUARD).toContain('location.pathname!=="/"');
    expect(PRERENDER_GUARD).toContain('html.lp-prerendered #root{visibility:hidden}');
  });
});
