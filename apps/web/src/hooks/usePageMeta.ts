import { useEffect } from 'react';

type PageMeta = {
  title: string;
  description?: string;
  /** Absolute URL. Only public, indexable pages should set one. */
  canonical?: string;
};

const SITE_TITLE = 'Loam Logger | Mountain bike service tracker';

function upsert(selector: string, create: () => HTMLElement): HTMLElement {
  const existing = document.head.querySelector<HTMLElement>(selector);
  if (existing) return existing;
  const el = create();
  document.head.appendChild(el);
  return el;
}

/**
 * Per-route title, description and canonical for the public pages. One
 * index.html serves every route, so anything static in its head applies to
 * the whole app; this hook lets a public page own its own tags while it is
 * mounted and clears the canonical when it unmounts, so signed-in routes
 * never carry one. Search engines that run JavaScript pick these up; the
 * prerendered landing page also gets the static defaults from index.html.
 */
export function usePageMeta({ title, description, canonical }: PageMeta): void {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;

    const descriptionEl = upsert('meta[name="description"]', () => {
      const m = document.createElement('meta');
      m.setAttribute('name', 'description');
      return m;
    });
    const previousDescription = descriptionEl.getAttribute('content');
    if (description) descriptionEl.setAttribute('content', description);

    let canonicalEl: HTMLElement | null = null;
    if (canonical) {
      canonicalEl = upsert('link[rel="canonical"]', () => {
        const l = document.createElement('link');
        l.setAttribute('rel', 'canonical');
        return l;
      });
      canonicalEl.setAttribute('href', canonical);
    }

    return () => {
      document.title = previousTitle || SITE_TITLE;
      if (previousDescription != null) descriptionEl.setAttribute('content', previousDescription);
      canonicalEl?.remove();
    };
  }, [title, description, canonical]);
}
