import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { localStorageMock } from '../test/setup';
import { useManualRideSourceChoice, readManualRideSourceChoice } from './useManualRideSourceChoice';

const capture = vi.fn();
vi.mock('@/lib/posthog', () => ({ posthog: { capture: (...args: unknown[]) => capture(...args) } }));

describe('useManualRideSourceChoice', () => {
  // A rider who opted out must not see the four connect buttons for a frame
  // before the stored choice is applied.
  it('reads the stored choice on the first render, not in an effect', () => {
    localStorageMock.getItem.mockReturnValue('1');

    const { result } = renderHook(() => useManualRideSourceChoice('user-1'));

    expect(result.current[0]).toBe(true);
    expect(localStorageMock.getItem).toHaveBeenCalledWith('loam-ride-source-manual:user-1');
  });

  it('is false with no account and without touching storage', () => {
    expect(readManualRideSourceChoice(undefined)).toBe(false);
    expect(localStorageMock.getItem).not.toHaveBeenCalled();
  });

  it('stores the choice per account and reports it', () => {
    localStorageMock.getItem.mockReturnValue(null);
    const { result } = renderHook(() => useManualRideSourceChoice('user-1'));

    act(() => result.current[1](true));

    expect(result.current[0]).toBe(true);
    expect(localStorageMock.setItem).toHaveBeenCalledWith('loam-ride-source-manual:user-1', '1');
    expect(capture).toHaveBeenCalledWith('ride_source_opted_out', { surface: 'dashboard' });

    act(() => result.current[1](false));

    expect(result.current[0]).toBe(false);
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('loam-ride-source-manual:user-1');
    expect(capture).toHaveBeenCalledWith('ride_source_opt_out_cleared', { surface: 'dashboard' });
  });

  // Private windows and blocked site data throw on access; the card still has
  // to render, and the choice still has to hold for the page.
  it('survives storage that throws', () => {
    localStorageMock.getItem.mockImplementation(() => {
      throw new Error('blocked');
    });
    localStorageMock.setItem.mockImplementation(() => {
      throw new Error('blocked');
    });

    const { result } = renderHook(() => useManualRideSourceChoice('user-1'));
    expect(result.current[0]).toBe(false);

    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
  });

  it('re-reads when the account changes', () => {
    localStorageMock.getItem.mockImplementation((key: string) => (key.endsWith(':user-1') ? '1' : null));

    const { result, rerender } = renderHook(({ userId }) => useManualRideSourceChoice(userId), {
      initialProps: { userId: 'user-1' as string | undefined },
    });
    expect(result.current[0]).toBe(true);

    rerender({ userId: 'user-2' });
    expect(result.current[0]).toBe(false);
  });
});
