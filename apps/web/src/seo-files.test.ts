import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { formatUsd, PRO_PRICE_MONTHLY_USD, PRO_PRICE_YEARLY_USD } from './constants/pricing';

/**
 * The crawler files in public/ are static text. These checks keep them from
 * drifting from the one place the price lives and from the production host.
 */
const publicDir = path.resolve(__dirname, '../public');
const read = (name: string) => readFileSync(path.join(publicDir, name), 'utf8');

describe('llms.txt', () => {
  const text = read('llms.txt');

  it('quotes the current Pro prices', () => {
    expect(text).toContain(`${formatUsd(PRO_PRICE_YEARLY_USD)} per year`);
    expect(text).toContain(`${formatUsd(PRO_PRICE_MONTHLY_USD)} per month`);
  });

  it('links only to the production host', () => {
    const hosts = [...text.matchAll(/https?:\/\/([^/\s)]+)/g)].map((m) => m[1]);
    expect(new Set(hosts)).toEqual(new Set(['loamlogger.app', 'apps.apple.com']));
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
});
