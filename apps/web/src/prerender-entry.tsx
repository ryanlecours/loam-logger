/**
 * Server-side entry used only by scripts/prerender-landing.mjs at build time.
 *
 * It renders the marketing landing page to static HTML so crawlers that do
 * not execute JavaScript (most AI crawlers, link unfurlers, some search
 * bots) still read the page's copy. The browser bundle then mounts over it
 * with createRoot and takes over; nothing here runs in the browser.
 */
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import MarketingLanding from './pages/MarketingLanding';

export function renderLanding(): string {
  return renderToString(
    <StaticRouter location="/">
      <MarketingLanding />
    </StaticRouter>,
  );
}
