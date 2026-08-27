/**
 * Shaping of 99spokes search results. These three helpers are pure and carry
 * the product decisions the search list depends on, so they are tested away
 * from the fetch/cache machinery around them.
 */
import { normalizeSearchResults, isFramesetResult, applyFramesetFilter } from './spokes';
import type { SpokesBike } from './spokes';

function bike(overrides: Partial<SpokesBike> = {}): SpokesBike {
  return {
    id: 'evil-offering-x0-2026',
    makerId: 'evil',
    maker: 'Evil',
    model: 'Offering X0',
    year: 2026,
    family: 'Offering',
    category: 'mountain',
    subcategory: null,
    ...overrides,
  };
}

describe('isFramesetResult', () => {
  it('trusts the explicit flag when 99spokes sends one', () => {
    expect(isFramesetResult(bike({ isFrameset: true }))).toBe(true);
    // Flag wins over a model name that would otherwise trip the fallback.
    expect(isFramesetResult(bike({ model: 'Offering Frame Only', isFrameset: false }))).toBe(false);
  });

  it('falls back to buildKind when the flag is absent', () => {
    expect(isFramesetResult(bike({ buildKind: 'frameset' }))).toBe(true);
    expect(isFramesetResult(bike({ buildKind: 'complete' }))).toBe(false);
  });

  it('falls back to the model name when neither field is sent', () => {
    expect(isFramesetResult(bike({ model: 'Offering Frame Only' }))).toBe(true);
    expect(isFramesetResult(bike({ model: 'Offering Frameset' }))).toBe(true);
    expect(isFramesetResult(bike({ model: 'Offering Frame Kit' }))).toBe(true);
    expect(isFramesetResult(bike({ model: 'Offering X0' }))).toBe(false);
  });

  it('does not mistake a complete bike from a brand named Framed', () => {
    expect(isFramesetResult(bike({ maker: 'Framed', model: 'Marquette Carbon' }))).toBe(false);
  });
});

describe('normalizeSearchResults', () => {
  it('keeps the thumbnail the search request already paid for', () => {
    const [result] = normalizeSearchResults([bike({ thumbnailUrl: 'https://img/x0.jpg' })]);

    expect(result.thumbnailUrl).toBe('https://img/x0.jpg');
  });

  it('nulls a missing thumbnail rather than dropping the field', () => {
    const [result] = normalizeSearchResults([bike()]);

    expect(result.thumbnailUrl).toBeNull();
  });

  it('puts the newest model year first', () => {
    const results = normalizeSearchResults([
      bike({ id: 'a', year: 2023 }),
      bike({ id: 'b', year: 2026 }),
      bike({ id: 'c', year: 2024 }),
    ]);

    expect(results.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('preserves upstream relevance order within a year', () => {
    const results = normalizeSearchResults([
      bike({ id: 'best-match', year: 2026 }),
      bike({ id: 'second', year: 2026 }),
      bike({ id: 'third', year: 2026 }),
    ]);

    expect(results.map((r) => r.id)).toEqual(['best-match', 'second', 'third']);
  });

  it('sorts a yearless listing last instead of to the top', () => {
    const results = normalizeSearchResults([
      bike({ id: 'unknown-year', year: undefined as unknown as number }),
      bike({ id: 'known', year: 2020 }),
    ]);

    expect(results.map((r) => r.id)).toEqual(['known', 'unknown-year']);
  });

  it('keeps framesets, flagged, so one cache entry serves both callers', () => {
    const results = normalizeSearchResults([bike({ model: 'Offering Frame Only' })]);

    expect(results).toHaveLength(1);
    expect(results[0].isFrameset).toBe(true);
  });
});

describe('applyFramesetFilter', () => {
  const results = normalizeSearchResults([
    bike({ id: 'complete', model: 'Offering X0' }),
    bike({ id: 'frame', model: 'Offering Frame Only' }),
  ]);

  it('drops frame-only listings when asked', () => {
    expect(applyFramesetFilter(results, true).map((r) => r.id)).toEqual(['complete']);
  });

  it('leaves them in by default, so Add Bike still offers them', () => {
    expect(applyFramesetFilter(results).map((r) => r.id)).toEqual(['complete', 'frame']);
    expect(applyFramesetFilter(results, false)).toHaveLength(2);
  });
});
