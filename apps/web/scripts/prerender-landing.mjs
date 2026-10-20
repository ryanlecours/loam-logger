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
  const markup = renderLanding();
  if (!markup.includes('Loam Logger tracks your bike')) {
    throw new Error('rendered landing markup is missing the hero headline');
  }

  const html = readFileSync(indexPath, 'utf8');
  const marker = '<div id="root"></div>';
  if (!html.includes(marker)) {
    throw new Error(`prerender: could not find ${marker} in ${indexPath}`);
  }
  // The same index.html serves every route of the SPA. On any path other
  // than "/", keep the static landing markup invisible until React mounts
  // and replaces it (main.tsx removes the class), so an app route never
  // flashes the marketing page.
  const guard =
    '<style>html.lp-prerendered #root{visibility:hidden}</style>' +
    '<script>if(location.pathname!=="/")document.documentElement.classList.add("lp-prerendered")</script>';
  writeFileSync(
    indexPath,
    html.replace('</head>', `${guard}</head>`).replace(marker, `<div id="root">${markup}</div>`),
  );
  console.log(`prerender: wrote ${Math.round(markup.length / 1024)} KB of landing markup into ${path.relative(repoRoot, indexPath)}`);
} finally {
  await server.close();
}
