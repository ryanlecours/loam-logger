import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useQuery } from '@apollo/client';
import { useRideSource, RIDE_SOURCE_POLL_MS } from './rideSource';
import type { RideSourceData } from '../utils/rideSourceState';

// The hook's one behavior of its own is when it polls. Apollo's own polling
// is not under test here, so useQuery is replaced and its start/stop calls
// are what the assertions read.
vi.mock('@apollo/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@apollo/client')>();
  return { ...original, useQuery: vi.fn() };
});

const startPolling = vi.fn();
const stopPolling = vi.fn();

function mockQuery(rideSource: RideSourceData | null) {
  vi.mocked(useQuery).mockReturnValue({
    data: rideSource ? { me: { id: 'user-1', rideSource } } : undefined,
    loading: false,
    error: undefined,
    refetch: vi.fn(),
    startPolling,
    stopPolling,
  } as unknown as ReturnType<typeof useQuery>);
}

const running: RideSourceData = {
  connectedProviders: ['garmin'],
  rideCount: 0,
  autoImport: {
    provider: 'garmin',
    status: 'RUNNING',
    ridesFound: 2,
    lookbackDays: 365,
    startedAt: '2026-10-28T11:00:00Z',
    completedAt: null,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useRideSource polling', () => {
  it('polls while an import is in flight and stops when it unmounts', () => {
    mockQuery(running);

    const { result, unmount } = renderHook(() => useRideSource());

    expect(result.current.rideSource).toEqual(running);
    expect(startPolling).toHaveBeenCalledWith(RIDE_SOURCE_POLL_MS);
    unmount();
    expect(stopPolling).toHaveBeenCalledTimes(1);
  });

  it('stops polling once the import settles', () => {
    mockQuery(running);
    const { rerender } = renderHook(() => useRideSource());
    expect(startPolling).toHaveBeenCalledTimes(1);

    mockQuery({
      ...running,
      autoImport: { ...running.autoImport!, status: 'COMPLETED', completedAt: '2026-10-28T11:20:00Z' },
    });
    rerender();

    expect(stopPolling).toHaveBeenCalledTimes(1);
    expect(startPolling).toHaveBeenCalledTimes(1);
  });

  // The first ride landing is what ends the wait, whatever the row says.
  it('stops polling once a ride lands', () => {
    mockQuery(running);
    const { rerender } = renderHook(() => useRideSource());

    mockQuery({ ...running, rideCount: 1 });
    rerender();

    expect(stopPolling).toHaveBeenCalledTimes(1);
  });

  it('does not poll with nothing connected or before the field has answered', () => {
    mockQuery({ connectedProviders: [], rideCount: 0, autoImport: null });
    renderHook(() => useRideSource());
    mockQuery(null);
    renderHook(() => useRideSource());

    expect(startPolling).not.toHaveBeenCalled();
  });
});
