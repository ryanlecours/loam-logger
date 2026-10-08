import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installChunkReloadHandler, RELOAD_WINDOW_MS } from './chunkReload';

function firePreloadError(): Event {
  const event = new Event('vite:preloadError', { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

describe('installChunkReloadHandler', () => {
  let uninstall: () => void = () => {};

  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    uninstall();
    vi.restoreAllMocks();
  });

  it('reloads and cancels the error on the first stale chunk', () => {
    const reload = vi.fn();
    uninstall = installChunkReloadHandler(reload, () => 1_000_000);

    const event = firePreloadError();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('lets the error through when a reload just happened, so it cannot loop', () => {
    const reload = vi.fn();
    let clock = 1_000_000;
    uninstall = installChunkReloadHandler(reload, () => clock);

    firePreloadError();
    clock += RELOAD_WINDOW_MS - 1;
    const second = firePreloadError();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(false);
  });

  it('reloads again once the window has passed', () => {
    const reload = vi.fn();
    let clock = 1_000_000;
    uninstall = installChunkReloadHandler(reload, () => clock);

    firePreloadError();
    clock += RELOAD_WINDOW_MS;
    firePreloadError();

    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('does not reload when sessionStorage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const reload = vi.fn();
    uninstall = installChunkReloadHandler(reload, () => 1_000_000);

    const event = firePreloadError();

    expect(reload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
