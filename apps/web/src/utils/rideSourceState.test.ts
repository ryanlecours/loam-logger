import { describe, it, expect } from 'vitest';
import {
  resolveRideSourceState,
  isRideSourceSettling,
  describeLookback,
  describeSince,
  rideProviderLabel,
  type AutoImportData,
} from './rideSourceState';

const BASE = { connectedProviders: [] as string[], rideCount: 0, autoImport: null, manualOnly: false };

const autoImport = (overrides: Partial<AutoImportData> = {}): AutoImportData => ({
  provider: 'strava',
  status: 'COMPLETED',
  ridesFound: 0,
  lookbackDays: 365,
  startedAt: '2026-10-28T11:00:00Z',
  completedAt: '2026-10-28T11:05:00Z',
  ...overrides,
});

describe('resolveRideSourceState', () => {
  it('asks for a ride source when nothing is connected and nothing ridden', () => {
    expect(resolveRideSourceState(BASE)).toEqual({ kind: 'none' });
  });

  // The rider said they track by hand; the card must stop asking.
  it('respects the rider who does not use a tracker', () => {
    expect(resolveRideSourceState({ ...BASE, manualOnly: true })).toEqual({ kind: 'manual' });
  });

  it('has nothing to say once any ride exists, whatever its source', () => {
    expect(resolveRideSourceState({ ...BASE, rideCount: 1 })).toEqual({ kind: 'has-rides' });
    expect(
      resolveRideSourceState({
        ...BASE,
        rideCount: 3,
        connectedProviders: ['garmin'],
        autoImport: autoImport({ provider: 'garmin', status: 'RUNNING' }),
      })
    ).toEqual({ kind: 'has-rides' });
  });

  it('reports a pending or running import with its progress', () => {
    expect(
      resolveRideSourceState({
        ...BASE,
        connectedProviders: ['strava'],
        autoImport: autoImport({ status: 'PENDING', ridesFound: null, completedAt: null }),
      })
    ).toEqual({ kind: 'importing', provider: 'strava', ridesFound: null, startedAt: '2026-10-28T11:00:00Z' });

    expect(
      resolveRideSourceState({
        ...BASE,
        connectedProviders: ['garmin'],
        autoImport: autoImport({ provider: 'garmin', status: 'RUNNING', ridesFound: 12, completedAt: null }),
      })
    ).toMatchObject({ kind: 'importing', provider: 'garmin', ridesFound: 12 });
  });

  it('reports a finished import that found nothing, with its window', () => {
    expect(
      resolveRideSourceState({ ...BASE, connectedProviders: ['strava'], autoImport: autoImport() })
    ).toEqual({ kind: 'empty', provider: 'strava', lookbackDays: 365 });
  });

  // Connected before the connect import existed: nothing ever ran, so there is
  // no window to name, but the rider still has a source and no rides.
  it('treats a connection with no import on record as empty, without a window', () => {
    expect(resolveRideSourceState({ ...BASE, connectedProviders: ['suunto'] })).toEqual({
      kind: 'empty',
      provider: 'suunto',
      lookbackDays: null,
    });
  });

  it('reports a failed import', () => {
    expect(
      resolveRideSourceState({
        ...BASE,
        connectedProviders: ['suunto'],
        autoImport: autoImport({ provider: 'suunto', status: 'FAILED', ridesFound: null }),
      })
    ).toEqual({ kind: 'failed', provider: 'suunto' });
  });

  // A connection outranks the opt-out: the rider connected something after all.
  it('ignores the opt-out once a provider is connected', () => {
    expect(
      resolveRideSourceState({ ...BASE, connectedProviders: ['whoop'], manualOnly: true })
    ).toMatchObject({ kind: 'empty', provider: 'whoop' });
  });
});

describe('isRideSourceSettling', () => {
  it('only polls while an import is in flight', () => {
    const running = autoImport({ status: 'RUNNING', ridesFound: null, completedAt: null });
    expect(isRideSourceSettling({ ...BASE, connectedProviders: ['strava'], autoImport: running })).toBe(true);
    expect(isRideSourceSettling({ ...BASE, connectedProviders: ['strava'], autoImport: autoImport() })).toBe(false);
    expect(isRideSourceSettling(BASE)).toBe(false);
    expect(isRideSourceSettling(null)).toBe(false);
  });

  // The first ride landing is what ends the wait, whatever the row says.
  it('stops once a ride exists even if the row still says running', () => {
    const running = autoImport({ status: 'RUNNING', ridesFound: 1, completedAt: null });
    expect(
      isRideSourceSettling({ ...BASE, rideCount: 1, connectedProviders: ['garmin'], autoImport: running })
    ).toBe(false);
  });
});

describe('copy helpers', () => {
  it('names the import window', () => {
    expect(describeLookback(365)).toBe('the last year');
    expect(describeLookback(30)).toBe('the last 30 days');
    expect(describeLookback(null)).toBeNull();
  });

  it('describes how long an import has run', () => {
    const now = new Date('2026-10-28T12:00:00Z');
    expect(describeSince('2026-10-28T11:59:30Z', now)).toBe('just now');
    expect(describeSince('2026-10-28T11:59:00Z', now)).toBe('1 minute ago');
    expect(describeSince('2026-10-28T11:45:00Z', now)).toBe('15 minutes ago');
    expect(describeSince('2026-10-28T09:00:00Z', now)).toBe('3 hours ago');
    expect(describeSince('2026-10-26T09:00:00Z', now)).toBe('2 days ago');
    expect(describeSince('not a date', now)).toBe('just now');
  });

  // The Garmin API Brand Guidelines forbid shortening the app name.
  it('uses the full Garmin Connect name', () => {
    expect(rideProviderLabel('garmin')).toBe('Garmin Connect™');
    expect(rideProviderLabel('whoop')).toBe('WHOOP');
    expect(rideProviderLabel('unknown')).toBe('unknown');
  });
});
