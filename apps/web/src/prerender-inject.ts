/**
 * Pure string work for the public-page prerender, kept apart from the script
 * that drives Vite so it can be unit tested.
 */
import { APPLE_APP_ID } from './constants/storeLinks';

export const ROOT_MARKER = '<div id="root"></div>';

/** Head tags a prerendered route writes into its own copy of index.html. */
export type RouteHead = {
  title: string;
  description: string;
  canonical: string;
};

export type PrerenderRoute = {
  /** The URL path the route is rendered for. */
  path: string;
  /**
   * Source of a regex matching every pathname this HTML file is served as
   * itself. On any other pathname the file is serving some other route of
   * the SPA and its static markup must stay hidden until React mounts.
   *
   * It is written straight into an inline regex literal in the guard
   * script, so every "/" in it must be escaped as "\\/" and it must not
   * contain "<"; buildGuard refuses a pattern that breaks either rule.
   */
  pathPattern: string;
  /**
   * Set when the file serves this route alone, so its head can carry the
   * route's own title, description and canonical. The landing shares
   * index.html with every route and therefore sets none.
   */
  head?: RouteHead;
  /** Smallest plausible markup size; a smaller render means a broken page. */
  minBytes: number;
};

/** "/" and "/index.html" are the landing page; index.html serves everything. */
export const LANDING_ROUTE: PrerenderRoute = {
  path: '/',
  pathPattern: '^\\/(index\\.html)?$',
  minBytes: 8_000,
};

/**
 * /app is written to its own file (app/index.html) so a crawler that skips
 * JavaScript reads this page's copy and head, not the landing page's.
 * Vercel serves a directory's index.html before it falls back to the SPA
 * rewrite, so no routing config is needed.
 */
export const GET_THE_APP_ROUTE: PrerenderRoute = {
  path: '/app',
  pathPattern: '^\\/app\\/?(index\\.html)?$',
  head: {
    title: 'Loam Logger app for iOS and Android | Mountain bike service tracker',
    description:
      'Get Loam Logger on the App Store or Google Play. The same account as the web app: rides sync from Garmin Connect, Strava or WHOOP, and every part on your bike shows its hours and whether it is due.',
    canonical: 'https://loamlogger.app/app',
  },
  minBytes: 3_000,
};

export const PRERENDER_ROUTES: PrerenderRoute[] = [LANDING_ROUTE, GET_THE_APP_ROUTE];

/**
 * Safari's Smart App Banner. It reads this tag at page load, not from tags a
 * script adds later, so it has to be in the static head, and index.html is
 * the static head of every route. The guard below removes it again on the
 * signed-in routes, where someone who chose the web app should not be nagged.
 */
export const SMART_BANNER_META = `<meta name="apple-itunes-app" content="app-id=${APPLE_APP_ID}">`;

/**
 * The routes that are not for crawlers or for the banner: the signed-in app
 * and the account-recovery pages. This is the Disallow list in
 * public/robots.txt as one regex, and seo-files.test.ts fails if the two
 * drift apart. The public pages (/, /app, /pricing, /login, /signup and the
 * rest) keep the banner on purpose: they are where a visitor decides.
 */
export const SIGNED_IN_PATH_PATTERN =
  '^\\/(dashboard|gear|rides|bikes|settings|admin|onboarding|auth|change-password|reset-password|forgot-password)(\\/|$)';

/** The pattern is dropped into a regex literal; an unescaped "/" ends it early. */
function assertInlinePattern(pattern: string): void {
  if (/(^|[^\\])\//.test(pattern)) {
    throw new Error(`prerender: path pattern ${pattern} has an unescaped "/" and would end the inline regex`);
  }
  // A pathname never needs "<", and "</script" anywhere inside the inline
  // script ends it, however the slash is escaped in the regex.
  if (pattern.includes('<')) {
    throw new Error('prerender: path pattern must not contain "<", which could close the inline script');
  }
}

/**
 * Builds the inline guard for one prerendered file. On any pathname the file
 * is not the page for, this keeps the static markup invisible until React
 * mounts and replaces it (RevealAfterMount removes the class), so an app
 * route never flashes a marketing page. Both pieces are inline: a
 * Content-Security-Policy without 'unsafe-inline' would disable the guard
 * silently.
 */
export function buildGuard(pathPattern: string): string {
  assertInlinePattern(pathPattern);
  assertInlinePattern(SIGNED_IN_PATH_PATTERN);
  return (
    '<style>html.lp-prerendered #root{visibility:hidden}</style>' +
    `<script>if(!/${pathPattern}/.test(location.pathname)){` +
    'document.documentElement.classList.add("lp-prerendered");' +
    // Safety valve: if the bundle never mounts (failed to load, threw before
    // the root rendered), stop hiding the page rather than leave it blank. The
    // landing markup showing late is a lesser failure than nothing showing.
    'setTimeout(function(){document.documentElement.classList.remove("lp-prerendered")},8000)' +
    '}' +
    `if(/${SIGNED_IN_PATH_PATTERN}/.test(location.pathname)){` +
    'var m=document.querySelector(\'meta[name="apple-itunes-app"]\');if(m)m.parentNode.removeChild(m)' +
    '}</script>'
  );
}

/** The landing page's guard, the one index.html carries. */
export const PRERENDER_GUARD = buildGuard(LANDING_ROUTE.pathPattern);

/**
 * JSON for a <script type="application/ld+json"> block. JSON.stringify leaves
 * "<" alone, so a value containing "</script>" would end the block early;
 * escaping "<" as < is valid JSON and inert in HTML.
 */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/** Structural checks only, so a copy edit never breaks the build. */
export function assertPageMarkup(markup: string, minBytes: number): void {
  if (!markup.includes('<main class="lp"')) {
    throw new Error('prerender: rendered markup is missing the <main class="lp"> root');
  }
  if (!/<h1[\s>]/.test(markup)) {
    throw new Error('prerender: rendered markup has no <h1>');
  }
  if (markup.length < minBytes) {
    throw new Error(`prerender: rendered markup is only ${markup.length} bytes; expected a full page`);
  }
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

/**
 * Rewrites the site-wide head defaults for a file that serves one route. Each
 * replacement targets a tag index.html is known to carry and throws if it is
 * missing, so a head edit cannot silently ship the landing page's title on
 * the /app page.
 */
export function applyRouteHead(html: string, head: RouteHead): string {
  const swaps: Array<[RegExp, string]> = [
    [/<title>[^<]*<\/title>/, `<title>${escapeText(head.title)}</title>`],
    [/(<meta name="description"\s+content=")[^"]*(")/, `$1${escapeAttr(head.description)}$2`],
    [/(<meta property="og:title" content=")[^"]*(")/, `$1${escapeAttr(head.title)}$2`],
    [/(<meta property="og:description" content=")[^"]*(")/, `$1${escapeAttr(head.description)}$2`],
    [/(<meta property="og:url" content=")[^"]*(")/, `$1${escapeAttr(head.canonical)}$2`],
    [/(<meta name="twitter:title" content=")[^"]*(")/, `$1${escapeAttr(head.title)}$2`],
    [/(<meta name="twitter:description" content=")[^"]*(")/, `$1${escapeAttr(head.description)}$2`],
  ];
  let out = html;
  for (const [pattern, replacement] of swaps) {
    if (!pattern.test(out)) {
      throw new Error(`prerender: index.html is missing the head tag matching ${pattern}`);
    }
    out = out.replace(pattern, replacement);
  }
  return out.replace('</head>', () => `<link rel="canonical" href="${escapeAttr(head.canonical)}" /></head>`);
}

/**
 * Writes a route's markup inside #root, its guard and the Smart App Banner
 * tag before </head>, and, for a route with its own file, that route's head.
 */
export function injectPrerendered(html: string, markup: string, route: PrerenderRoute): string {
  assertPageMarkup(markup, route.minBytes);
  if (!html.includes('</head>')) {
    throw new Error('prerender: index.html has no </head>');
  }
  if (!html.includes(ROOT_MARKER)) {
    throw new Error(`prerender: could not find ${ROOT_MARKER} in index.html`);
  }
  const withHead = route.head ? applyRouteHead(html, route.head) : html;
  // Function replacers: a string replacement would interpret $&, $' and $$
  // inside the markup, and the copy carries dollar prices.
  return withHead
    .replace('</head>', () => `${SMART_BANNER_META}${buildGuard(route.pathPattern)}</head>`)
    .replace(ROOT_MARKER, () => `<div id="root">${markup}</div>`);
}
