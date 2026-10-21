/**
 * Pure string work for the landing prerender, kept apart from the script
 * that drives Vite so it can be unit tested.
 */

export const ROOT_MARKER = '<div id="root"></div>';

/**
 * The same index.html serves every route of the SPA. On any path other than
 * "/", this keeps the static landing markup invisible until React mounts and
 * replaces it (RevealAfterMount removes the class), so an app route never
 * flashes the marketing page. Both pieces are inline: a Content-Security-Policy
 * without 'unsafe-inline' would disable the guard silently.
 */
export const PRERENDER_GUARD =
  '<style>html.lp-prerendered #root{visibility:hidden}</style>' +
  '<script>if(!/^\\/(index\\.html)?$/.test(location.pathname))document.documentElement.classList.add("lp-prerendered")</script>';

/**
 * JSON for a <script type="application/ld+json"> block. JSON.stringify leaves
 * "<" alone, so a value containing "</script>" would end the block early;
 * escaping "<" as < is valid JSON and inert in HTML.
 */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

const MIN_MARKUP_BYTES = 8_000;

/** Structural checks only, so a copy edit never breaks the build. */
export function assertLandingMarkup(markup: string): void {
  if (!markup.includes('<main class="lp"')) {
    throw new Error('prerender: rendered landing markup is missing the <main class="lp"> root');
  }
  if (!/<h1[\s>]/.test(markup)) {
    throw new Error('prerender: rendered landing markup has no <h1>');
  }
  if (markup.length < MIN_MARKUP_BYTES) {
    throw new Error(`prerender: rendered landing markup is only ${markup.length} bytes; expected a full page`);
  }
}

export function injectLanding(html: string, markup: string): string {
  assertLandingMarkup(markup);
  if (!html.includes('</head>')) {
    throw new Error('prerender: index.html has no </head>');
  }
  if (!html.includes(ROOT_MARKER)) {
    throw new Error(`prerender: could not find ${ROOT_MARKER} in index.html`);
  }
  // Function replacers: a string replacement would interpret $&, $' and $$
  // inside the markup, and the copy carries dollar prices.
  return html
    .replace('</head>', () => `${PRERENDER_GUARD}</head>`)
    .replace(ROOT_MARKER, () => `<div id="root">${markup}</div>`);
}
