/**
 * Post-build step: prerender the landing page into the built index.html.
 *
 * Vite builds a client-only SPA, so the shipped index.html has an empty
 * #root and crawlers that skip JavaScript see nothing. This script loads the
 * app through Vite's SSR module loader, renders the landing route to a
 * string, and writes it inside #root. Every other route still boots from the
 * same file; React's createRoot replaces the static markup on mount.
 *
 * Usage (from the monorepo root, after `nx build web`):
 *   node apps/web/scripts/prerender-landing.mjs [dist/apps/web/index.html]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const repoRoot = path.resolve(webRoot, '../..');
const indexPath = path.resolve(process.argv[2] ?? path.join(repoRoot, 'dist/apps/web/index.html'));

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
  const { renderLanding } = await server.ssrLoadModule('/src/prerender-entry.tsx');
  const { injectLanding } = await server.ssrLoadModule('/src/prerender-inject.ts');
  const markup = renderLanding();

  // On "/" the browser bundle mounts with createRoot, not hydrateRoot, so
  // React discards this markup and paints its own identical tree. That is a
  // deliberate trade: hydrating would require every provider in main.tsx to
  // render identically on the server, and the swap is of like for like. The
  // guard that hides the markup on other routes, and its CSP caveat, live in
  // src/prerender-inject.ts.
  writeFileSync(indexPath, injectLanding(readFileSync(indexPath, 'utf8'), markup));
  console.log(`prerender: wrote ${Math.round(markup.length / 1024)} KB of landing markup into ${path.relative(repoRoot, indexPath)}`);
} finally {
  await server.close();
}
