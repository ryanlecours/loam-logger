/**
 * Post-build step: prerender the public marketing pages into the built site.
 *
 * Vite builds a client-only SPA, so the shipped index.html has an empty
 * #root and crawlers that skip JavaScript see nothing. This script loads the
 * app through Vite's SSR module loader and renders each public route to a
 * string. The landing page is written inside #root of index.html, which
 * serves every route; each other route gets its own copy of index.html at
 * <route>/index.html with that route's markup and head, which Vercel serves
 * ahead of the SPA rewrite. React's createRoot replaces the static markup
 * on mount.
 *
 * Usage (from the monorepo root, after `nx build web`):
 *   node apps/web/scripts/prerender-landing.mjs [dist/apps/web/index.html]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const repoRoot = path.resolve(webRoot, '../..');
const indexPath = path.resolve(process.argv[2] ?? path.join(repoRoot, 'dist/apps/web/index.html'));
const outDir = path.dirname(indexPath);

if (!existsSync(indexPath)) {
  console.error(`prerender: ${indexPath} not found. Run the web build first.`);
  process.exit(1);
}

const server = await createServer({
  configFile: path.join(webRoot, 'vite.config.ts'),
  root: webRoot,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
});

try {
  const { renderRoute } = await server.ssrLoadModule('/src/prerender-entry.tsx');
  const { injectPrerendered, PRERENDER_ROUTES } = await server.ssrLoadModule('/src/prerender-inject.ts');

  // Read the untouched build output once: every route starts from it.
  const template = readFileSync(indexPath, 'utf8');

  for (const route of PRERENDER_ROUTES) {
    // On its own path the browser bundle mounts with createRoot, not
    // hydrateRoot, so React discards this markup and paints its own identical
    // tree. That is a deliberate trade: hydrating would require every provider
    // in main.tsx to render identically on the server, and the swap is of like
    // for like. The guard that hides the markup on other routes, and its CSP
    // caveat, live in src/prerender-inject.ts.
    const markup = renderRoute(route.path);
    const html = injectPrerendered(template, markup, route);
    const target =
      route.path === '/' ? indexPath : path.join(outDir, route.path.replace(/^\//, ''), 'index.html');
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, html);
    console.log(
      `prerender: wrote ${Math.round(markup.length / 1024)} KB of ${route.path} markup into ${path.relative(repoRoot, target)}`,
    );
  }
} finally {
  await server.close();
}
