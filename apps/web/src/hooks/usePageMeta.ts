import { useEffect } from 'react';

type PageMeta = {
  title: string;
  description?: string;
  /** Absolute URL. Only public, indexable pages should set one. */
  canonical?: string;
};

/**
 * Per-route title, description and canonical for the public pages. One
 * index.html serves every route, so anything static in its head applies to
 * the whole app; this hook lets a public page own its own tags while it is
 * mounted and puts the head back exactly as it found it on unmount.
 *
 * Every element this hook touches is tracked: a description tag it created
 * is removed, one it found is restored to its previous content, and the
 * canonical link is always this call's own element, so two pages that
 * overlap during a route transition never remove each other's tag.
 */
export function usePageMeta({ title, description, canonical }: PageMeta): void {
  useEffect(() => {
    const head = document.head;
    const previousTitle = document.title;
    document.title = title;

    let descriptionEl: HTMLMetaElement | null = null;
    let createdDescription = false;
    let previousDescription: string | null = null;
    if (description) {
      descriptionEl = head.querySelector<HTMLMetaElement>('meta[name="description"]');
      if (descriptionEl) {
        previousDescription = descriptionEl.getAttribute('content');
      } else {
        descriptionEl = document.createElement('meta');
        descriptionEl.setAttribute('name', 'description');
        head.appendChild(descriptionEl);
        createdDescription = true;
      }
      descriptionEl.setAttribute('content', description);
    }

    let canonicalEl: HTMLLinkElement | null = null;
    // A prerendered page served from its own file (app/index.html) already
    // carries this exact canonical in its static head. Adding a second copy
    // would hand crawlers two identical tags, so the static one is adopted
    // instead, and like a created one it is removed on unmount: after a
    // client-side navigation to another page it would otherwise sit beside
    // that page's canonical. The href is compared, not interpolated into a
    // selector, so the value needs no escaping.
    if (canonical) {
      const existing = Array.from(head.querySelectorAll<HTMLLinkElement>('link[rel="canonical"]')).find(
        (el) => el.getAttribute('href') === canonical,
      );
      if (existing) {
        canonicalEl = existing;
      } else {
        canonicalEl = document.createElement('link');
        canonicalEl.setAttribute('rel', 'canonical');
        canonicalEl.setAttribute('href', canonical);
        head.appendChild(canonicalEl);
      }
    }

    return () => {
      document.title = previousTitle;
      if (descriptionEl) {
        if (createdDescription) descriptionEl.remove();
        else if (previousDescription != null) descriptionEl.setAttribute('content', previousDescription);
      }
      canonicalEl?.remove();
    };
  }, [title, description, canonical]);
}
