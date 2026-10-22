import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const { mockPosthog, callbacks, unsubscribe } = vi.hoisted(() => {
  const callbacks: Array<() => void> = [];
  const unsubscribe = vi.fn();
  const mockPosthog = {
    onFeatureFlags: vi.fn((cb: () => void) => {
      callbacks.push(cb);
      return unsubscribe;
    }),
    isFeatureEnabled: vi.fn<(key: string, opts?: unknown) => boolean | undefined>(),
    getFeatureFlagPayload: vi.fn<(key: string) => unknown>(),
    reloadFeatureFlags: vi.fn(),
  };
  return { mockPosthog, callbacks, unsubscribe };
});

vi.mock('@/lib/posthog', () => ({ posthog: mockPosthog }));

import {
  DEFAULT_OUTAGE_MESSAGE,
  OUTAGE_FLAG_KEY,
  readOutageNotice,
  useOutageNotice,
} from './useOutageNotice';

function flagsLoaded() {
  act(() => {
    callbacks.forEach((cb) => cb());
  });
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('readOutageNotice', () => {
  it('is null while the flag is off or unknown', () => {
    expect(readOutageNotice(false, { message: 'ignored' })).toBeNull();
    expect(readOutageNotice(undefined, { message: 'ignored' })).toBeNull();
  });

  it('reads the message from an object payload', () => {
    expect(readOutageNotice(true, { message: 'Sync is delayed.' })).toEqual({ message: 'Sync is delayed.' });
  });

  it('accepts a bare string payload', () => {
    expect(readOutageNotice(true, 'Back shortly.')).toEqual({ message: 'Back shortly.' });
  });

  it('falls back to the default copy when the payload is missing or blank', () => {
    expect(readOutageNotice(true, undefined)).toEqual({ message: DEFAULT_OUTAGE_MESSAGE });
    expect(readOutageNotice(true, null)).toEqual({ message: DEFAULT_OUTAGE_MESSAGE });
    expect(readOutageNotice(true, {})).toEqual({ message: DEFAULT_OUTAGE_MESSAGE });
    expect(readOutageNotice(true, { message: '   ' })).toEqual({ message: DEFAULT_OUTAGE_MESSAGE });
    expect(readOutageNotice(true, { message: 42 })).toEqual({ message: DEFAULT_OUTAGE_MESSAGE });
  });
});

describe('useOutageNotice', () => {
  beforeEach(() => {
    callbacks.length = 0;
    vi.clearAllMocks();
    mockPosthog.isFeatureEnabled.mockReturnValue(undefined);
    mockPosthog.getFeatureFlagPayload.mockReturnValue(undefined);
  });

  it('is null until flags have loaded', () => {
    const { result } = renderHook(() => useOutageNotice());
    expect(result.current).toBeNull();
    expect(mockPosthog.onFeatureFlags).toHaveBeenCalledTimes(1);
  });

  it('reports the notice once the flag loads on, without emitting a flag-called event', () => {
    mockPosthog.isFeatureEnabled.mockReturnValue(true);
    mockPosthog.getFeatureFlagPayload.mockReturnValue({ message: 'Database maintenance until 3pm ET.' });

    const { result } = renderHook(() => useOutageNotice());
    flagsLoaded();

    expect(result.current).toEqual({ message: 'Database maintenance until 3pm ET.' });
    expect(mockPosthog.isFeatureEnabled).toHaveBeenCalledWith(OUTAGE_FLAG_KEY, { send_event: false });
    expect(mockPosthog.getFeatureFlagPayload).toHaveBeenCalledWith(OUTAGE_FLAG_KEY);
  });

  it('clears the notice when a later flag load reports it off', () => {
    mockPosthog.isFeatureEnabled.mockReturnValue(true);
    const { result } = renderHook(() => useOutageNotice());
    flagsLoaded();
    expect(result.current).toEqual({ message: DEFAULT_OUTAGE_MESSAGE });

    mockPosthog.isFeatureEnabled.mockReturnValue(false);
    flagsLoaded();
    expect(result.current).toBeNull();
  });

  it('asks for fresh flags when the tab becomes visible again', () => {
    renderHook(() => useOutageNotice());

    setVisibility('hidden');
    expect(mockPosthog.reloadFeatureFlags).not.toHaveBeenCalled();

    setVisibility('visible');
    expect(mockPosthog.reloadFeatureFlags).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useOutageNotice());
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    expect(mockPosthog.reloadFeatureFlags).not.toHaveBeenCalled();
  });
});
