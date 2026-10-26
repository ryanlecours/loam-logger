/**
 * Server-side entry used only by scripts/prerender-landing.mjs at build time.
 *
 * It renders the public marketing pages to static HTML so crawlers that do
 * not execute JavaScript (most AI crawlers, link unfurlers, some search
 * bots) still read each page's copy. The browser bundle then mounts over it
 * with createRoot and takes over; nothing here runs in the browser.
 */
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import MarketingLanding from './pages/MarketingLanding';
import GetTheApp from './pages/GetTheApp';

const PAGES: Record<string, () => ReactElement> = {
  '/': () => <MarketingLanding />,
  '/app': () => <GetTheApp />,
};

export function renderRoute(path: string): string {
  const page = PAGES[path];
  if (!page) {
    throw new Error(`prerender: no page registered for ${path}`);
  }
  return renderToString(<StaticRouter location={path}>{page()}</StaticRouter>);
}

export function renderLanding(): string {
  return renderRoute('/');
}
