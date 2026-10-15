/**
 * Recover from stale code-split chunks after a deploy.
 *
 * Each Vercel deploy replaces the hashed files under /assets. A tab opened
 * before the deploy still runs the old entry bundle, so the first lazy route
 * it visits afterwards asks for a chunk that no longer exists and the page
 * crashes ("Failed to fetch dynamically imported module", JAVASCRIPT-REACT-4).
 *
 * Vite dispatches `vite:preloadError` for exactly this failure. Reloading
 * picks up the new entry bundle. The reload is skipped when one already
 * happened in the last RELOAD_WINDOW_MS, so a chunk that is genuinely missing
 * from the current deploy still throws and reaches Sentry instead of looping.
 */

const STORAGE_KEY = 'loam:chunk-reload-at';
export const RELOAD_WINDOW_MS = 10_000;

function readLastReload(): number {
  try {
    return Number(sessionStorage.getItem(STORAGE_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeLastReload(at: number): boolean {
  try {
    sessionStorage.setItem(STORAGE_KEY, String(at));
    return true;
  } catch {
    // Without storage the loop guard cannot work, so do not reload at all.
    return false;
  }
}

export function installChunkReloadHandler(
  reload: () => void = () => window.location.reload(),
  now: () => number = Date.now
): () => void {
  const onPreloadError = (event: Event) => {
    const at = now();
    if (at - readLastReload() < RELOAD_WINDOW_MS) return;
    if (!writeLastReload(at)) return;
    // Cancelling stops Vite from rethrowing, so the error boundary does not
    // flash an error screen during the reload.
    event.preventDefault();
    reload();
  };

  window.addEventListener('vite:preloadError', onPreloadError);
  return () => window.removeEventListener('vite:preloadError', onPreloadError);
}
