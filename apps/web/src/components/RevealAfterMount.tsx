import { useEffect } from 'react';

/**
 * The built index.html carries the prerendered landing page inside #root and,
 * on any path other than "/", a class that keeps it invisible
 * (apps/web/scripts/prerender-landing.mjs). Once React has committed its own
 * tree the static markup is gone, so this reveals the app.
 */
export default function RevealAfterMount() {
  useEffect(() => {
    document.documentElement.classList.remove('lp-prerendered');
  }, []);
  return null;
}
