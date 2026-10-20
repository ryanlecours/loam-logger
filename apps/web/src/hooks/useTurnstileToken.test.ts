import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTurnstileToken } from './useTurnstileToken';

afterEach(() => vi.useRealTimers());

describe('useTurnstileToken', () => {
  it('answers at once when disabled or a token is already held', async () => {
    const disabled = renderHook(() => useTurnstileToken(false));
    await expect(disabled.result.current.waitForToken()).resolves.toBeNull();

    const { result } = renderHook(() => useTurnstileToken(true));
    act(() => result.current.onToken('tok'));
    await expect(result.current.waitForToken()).resolves.toBe('tok');
    expect(result.current.isWaiting).toBe(false);
  });

  it('settles a pending wait when the page unmounts, and clears its timer', async () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useTurnstileToken(true, 8000));

    let pending!: Promise<string | null>;
    act(() => {
      pending = result.current.waitForToken();
    });
    expect(result.current.isWaiting).toBe(true);
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    await expect(pending).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('settles every pending wait with the next token', async () => {
    const { result } = renderHook(() => useTurnstileToken(true));

    let first!: Promise<string | null>;
    let second!: Promise<string | null>;
    act(() => {
      first = result.current.waitForToken();
      second = result.current.waitForToken();
    });
    act(() => result.current.onToken('tok'));

    await expect(first).resolves.toBe('tok');
    await expect(second).resolves.toBe('tok');
    expect(result.current.isWaiting).toBe(false);
  });
});
