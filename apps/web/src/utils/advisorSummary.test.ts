import { describe, it, expect } from 'vitest';
import { buildAdvisorSummaryMap, mergeAdvisorSummaries, type AdvisorBikeRow } from './advisorSummary';
import type { BikeWithPredictions } from '../hooks/usePriorityBike';
import type { AdvisorSummary, BikePredictionSummary } from '../types/prediction';

const summary = (text: string): AdvisorSummary => ({
  text,
  generatedAt: '2026-07-16T00:00:00.000Z',
  modelVersion: 'claude-haiku-4-5-20251001',
});

const predictions = (bikeId: string): BikePredictionSummary => ({
  bikeId,
  bikeName: `Bike ${bikeId}`,
  components: [],
  priorityComponent: null,
  overallStatus: 'DUE_SOON',
  dueNowCount: 0,
  dueSoonCount: 1,
  generatedAt: '2026-07-16T00:00:00.000Z',
});

const bike = (id: string, withPredictions = true): BikeWithPredictions => ({
  id,
  manufacturer: 'Trek',
  model: 'Slash',
  sortOrder: 0,
  predictions: withPredictions ? predictions(id) : null,
});

const advisorRow = (
  id: string,
  advisorSummary: AdvisorSummary | null,
  hasPredictions = true
): AdvisorBikeRow => ({
  id,
  advisorPredictions: hasPredictions ? { bikeId: id, advisorSummary } : null,
});

describe('buildAdvisorSummaryMap', () => {
  it('returns an empty map for undefined input', () => {
    expect(buildAdvisorSummaryMap(undefined).size).toBe(0);
  });

  it('maps bikeId to its advisor summary', () => {
    const map = buildAdvisorSummaryMap([advisorRow('a', summary('service the fork'))]);
    expect(map.get('a')).toEqual(summary('service the fork'));
  });

  it('keeps a present-but-null summary (distinct from absent)', () => {
    const map = buildAdvisorSummaryMap([advisorRow('a', null)]);
    expect(map.has('a')).toBe(true);
    expect(map.get('a')).toBeNull();
  });

  it('omits rows whose advisorPredictions is null', () => {
    const map = buildAdvisorSummaryMap([advisorRow('a', null, false)]);
    expect(map.has('a')).toBe(false);
  });
});

describe('mergeAdvisorSummaries', () => {
  it('returns the input array unchanged when the map is empty', () => {
    const bikes = [bike('a'), bike('b')];
    expect(mergeAdvisorSummaries(bikes, new Map())).toBe(bikes);
  });

  it('attaches the summary onto the matching bike only', () => {
    const bikes = [bike('a'), bike('b')];
    const map = new Map([['a', summary('service the fork')]]);

    const merged = mergeAdvisorSummaries(bikes, map);

    expect(merged[0].predictions?.advisorSummary).toEqual(summary('service the fork'));
    // Bike b wasn't in the map — its summary resolves to null, not a's summary.
    expect(merged[1].predictions?.advisorSummary).toBeNull();
  });

  it('passes through bikes without predictions untouched', () => {
    const noPred = bike('a', false);
    const merged = mergeAdvisorSummaries([noPred], new Map([['a', summary('x')]]));
    expect(merged[0]).toBe(noPred);
    expect(merged[0].predictions).toBeNull();
  });

  it('does not mutate the input bikes', () => {
    const bikes = [bike('a')];
    const before = bikes[0].predictions;
    mergeAdvisorSummaries(bikes, new Map([['a', summary('x')]]));
    // Original object identity + fields preserved (merge is immutable).
    expect(bikes[0].predictions).toBe(before);
    expect('advisorSummary' in (bikes[0].predictions ?? {})).toBe(false);
  });

  it('overwrites a stale summary with null when the bike drops out of the map', () => {
    const bikes = [bike('a')];
    const merged = mergeAdvisorSummaries(bikes, new Map([['b', summary('other')]]));
    expect(merged[0].predictions?.advisorSummary).toBeNull();
  });
});
