import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '../test/test-utils';
import GetTheApp from './GetTheApp';
import { APP_STORE_URL, PLAY_STORE_URL } from '../constants/storeLinks';

describe('GetTheApp', () => {
  it('names both platforms in the heading and links to both stores', () => {
    render(<GetTheApp />, { route: '/app' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Loam Logger, in your pocket.');
    expect(screen.getByText('iOS and Android')).toBeInTheDocument();

    const appStore = screen.getAllByRole('link', { name: /App Store/ });
    const play = screen.getAllByRole('link', { name: /Google Play/ });
    expect(appStore.length).toBeGreaterThan(0);
    expect(play.length).toBeGreaterThan(0);
    for (const link of appStore) expect(link).toHaveAttribute('href', expect.stringContaining(APP_STORE_URL));
    for (const link of play) expect(link).toHaveAttribute('href', expect.stringContaining(PLAY_STORE_URL));
    for (const link of [...appStore, ...play]) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    }
  });

  it('uses the stores’ own badge artwork with the badge text as alt', () => {
    render(<GetTheApp />, { route: '/app' });
    expect(screen.getAllByAltText('Download on the App Store').length).toBeGreaterThan(0);
    expect(screen.getAllByAltText('Get it on Google Play').length).toBeGreaterThan(0);
  });

  it('publishes a MobileApplication node per store that points back at the site app node', () => {
    const { container } = render(<GetTheApp />, { route: '/app' });
    const scripts = Array.from(container.querySelectorAll('script[type="application/ld+json"]'));
    const graph = scripts.map((s) => JSON.parse(s.textContent ?? '{}')).find((d) => Array.isArray(d['@graph']));
    const apps = graph['@graph'].filter((n: { '@type': string }) => n['@type'] === 'MobileApplication');
    expect(apps.map((a: { operatingSystem: string }) => a.operatingSystem).sort()).toEqual(['Android', 'iOS']);
    expect(apps.map((a: { installUrl: string }) => a.installUrl).sort()).toEqual([APP_STORE_URL, PLAY_STORE_URL].sort());
    for (const app of apps) expect(app.isPartOf['@id']).toBe('https://loamlogger.app/#app');
  });

  it('does not fabricate social proof or a rating', () => {
    const { container } = render(<GetTheApp />, { route: '/app' });
    expect(screen.queryByText(/riders trust/i)).not.toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/aggregateRating/);
  });
});
