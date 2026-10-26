import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { formatUsd, PRO_PRICE_MONTHLY_USD, PRO_PRICE_YEARLY_USD } from './constants/pricing';
import { ANDROID_PACKAGE, APP_STORE_URL, APPLE_APP_ID, PLAY_STORE_URL } from './constants/storeLinks';

/**
 * The crawler files in public/ are static text. These checks keep them from
 * drifting from the one place the price lives, the one place the store
 * identities live, and the production host.
 */
const publicDir = path.resolve(__dirname, '../public');
const read = (name: string) => readFileSync(path.join(publicDir, name), 'utf8');

describe('llms.txt', () => {
  const text = read('llms.txt');

  it('quotes the current Pro prices', () => {
    expect(text).toContain(`${formatUsd(PRO_PRICE_YEARLY_USD)} per year`);
    expect(text).toContain(`${formatUsd(PRO_PRICE_MONTHLY_USD)} per month`);
  });

  it('links only to the production host and the two stores', () => {
    const hosts = [...text.matchAll(/https?:\/\/([^/\s)]+)/g)].map((m) => m[1]);
    expect(new Set(hosts)).toEqual(new Set(['loamlogger.app', 'apps.apple.com', 'play.google.com']));
  });

  it('points at both store listings and the download page', () => {
    expect(text).toContain(APP_STORE_URL);
    expect(text).toContain(PLAY_STORE_URL);
    expect(text).toContain('https://loamlogger.app/app');
  });
});

describe('sitemap.xml', () => {
  const xml = read('sitemap.xml');

  it('lists only production URLs for public routes', () => {
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.length).toBeGreaterThan(0);
    for (const loc of locs) expect(loc.startsWith('https://loamlogger.app/')).toBe(true);
    expect(locs).toContain('https://loamlogger.app/');
    expect(locs).toContain('https://loamlogger.app/pricing');
    expect(locs).toContain('https://loamlogger.app/app');
  });

  it('dates its lastmod entries as full ISO days', () => {
    const dates = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
    expect(dates.length).toBeGreaterThan(0);
    for (const d of dates) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('robots.txt', () => {
  const txt = read('robots.txt');

  it('points at the sitemap and keeps signed-in routes out', () => {
    expect(txt).toContain('Sitemap: https://loamlogger.app/sitemap.xml');
    for (const route of ['/dashboard', '/gear', '/rides', '/settings', '/admin']) {
      expect(txt).toContain(`Disallow: ${route}`);
    }
  });

  it('leaves the download page crawlable', () => {
    expect(txt).not.toMatch(/Disallow: \/app\b/);
  });
});

describe('site.webmanifest', () => {
  const manifest = JSON.parse(read('site.webmanifest'));

  it('names both native apps so Chrome and Safari can offer them', () => {
    const related = manifest.related_applications as Array<{ platform: string; id?: string; url: string }>;
    expect(manifest.prefer_related_applications).toBe(true);
    expect(related.find((r) => r.platform === 'play')).toEqual({ platform: 'play', id: ANDROID_PACKAGE, url: PLAY_STORE_URL });
    expect(related.find((r) => r.platform === 'itunes')).toEqual({ platform: 'itunes', id: APPLE_APP_ID, url: APP_STORE_URL });
  });
});

describe('.well-known', () => {
  it('verifies App Links for the same Android package the site links to', () => {
    const links = JSON.parse(read('.well-known/assetlinks.json')) as Array<{ target: { package_name: string } }>;
    expect(links.map((l) => l.target.package_name)).toContain(ANDROID_PACKAGE);
  });

  it('verifies Universal Links for the same bundle id', () => {
    const aasa = JSON.parse(read('.well-known/apple-app-site-association'));
    const appIds: string[] = aasa.applinks.details.flatMap((d: { appIDs: string[] }) => d.appIDs);
    expect(appIds.some((id) => id.endsWith(`.${ANDROID_PACKAGE}`))).toBe(true);
  });
});
