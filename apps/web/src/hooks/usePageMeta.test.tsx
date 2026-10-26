import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { usePageMeta } from './usePageMeta';

function Page({ title, description, canonical }: { title: string; description?: string; canonical?: string }) {
  usePageMeta({ title, description, canonical });
  return null;
}

const descriptionTag = () => document.head.querySelector('meta[name="description"]');
const canonicalTags = () => document.head.querySelectorAll('link[rel="canonical"]');

describe('usePageMeta', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.title = 'Site default';
  });

  it('sets the title, description and canonical while mounted and restores on unmount', () => {
    const existing = document.createElement('meta');
    existing.setAttribute('name', 'description');
    existing.setAttribute('content', 'site description');
    document.head.appendChild(existing);

    const { unmount } = render(
      <Page title="Pricing | Loam Logger" description="pricing description" canonical="https://loamlogger.app/pricing" />,
    );
    expect(document.title).toBe('Pricing | Loam Logger');
    expect(descriptionTag()?.getAttribute('content')).toBe('pricing description');
    expect(canonicalTags()).toHaveLength(1);
    expect(canonicalTags()[0].getAttribute('href')).toBe('https://loamlogger.app/pricing');

    unmount();
    expect(document.title).toBe('Site default');
    expect(descriptionTag()?.getAttribute('content')).toBe('site description');
    expect(canonicalTags()).toHaveLength(0);
  });

  it('removes a description tag it had to create, rather than leaving marketing copy on app routes', () => {
    const { unmount } = render(<Page title="Landing" description="landing description" />);
    expect(descriptionTag()?.getAttribute('content')).toBe('landing description');
    unmount();
    expect(descriptionTag()).toBeNull();
  });

  it('leaves the description alone when a page sets none', () => {
    const { unmount } = render(<Page title="Only a title" />);
    expect(descriptionTag()).toBeNull();
    unmount();
    expect(descriptionTag()).toBeNull();
  });

  it('only removes its own canonical when two pages overlap', () => {
    const first = render(<Page title="A" canonical="https://loamlogger.app/a" />);
    const second = render(<Page title="B" canonical="https://loamlogger.app/b" />);
    expect(canonicalTags()).toHaveLength(2);

    first.unmount();
    expect(canonicalTags()).toHaveLength(1);
    expect(canonicalTags()[0].getAttribute('href')).toBe('https://loamlogger.app/b');

    second.unmount();
    expect(canonicalTags()).toHaveLength(0);
  });

  it('reuses a matching canonical already in the static head and leaves it in place', () => {
    const existing = document.createElement('link');
    existing.setAttribute('rel', 'canonical');
    existing.setAttribute('href', 'https://loamlogger.app/app');
    document.head.appendChild(existing);

    const { unmount } = render(<Page title="App" canonical="https://loamlogger.app/app" />);
    expect(canonicalTags()).toHaveLength(1);
    unmount();
    expect(canonicalTags()).toHaveLength(1);
    expect(canonicalTags()[0]).toBe(existing);
  });
});
