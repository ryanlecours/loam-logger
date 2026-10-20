import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import CheckEmailNotice from './CheckEmailNotice';
import { EMAIL_SIGN_IN_POLL_LIMIT_MS, emailSignInPollDelay } from '@/lib/emailVerification';

function reply(status: number, body: unknown = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const PENDING = reply(202, { pending: true, code: 'EMAIL_VERIFICATION_PENDING' });
const SIGNED_IN = reply(200, { ok: true, mustChangePassword: false, csrfToken: 'csrf-1' });

let visibility: 'visible' | 'hidden' = 'visible';

function setVisibility(state: 'visible' | 'hidden') {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

const completeCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([url]) => (url as string).endsWith('/auth/verify-email/complete'));

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CheckEmailNotice waiting to sign in', () => {
  it('asks every few seconds and signs in once the link is opened', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(PENDING).mockResolvedValueOnce(PENDING).mockResolvedValue(SIGNED_IN);
    vi.stubGlobal('fetch', fetchMock);
    const onSignedIn = vi.fn();
    render(<CheckEmailNotice email="rider@example.com" onSignedIn={onSignedIn} />);

    expect(screen.getByText(/Open it on any device/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(completeCalls(fetchMock)).toHaveLength(1);
    expect(completeCalls(fetchMock)[0][1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ email: 'rider@example.com' }),
    });

    await act(() => vi.advanceTimersByTimeAsync(6_000));
    expect(completeCalls(fetchMock)).toHaveLength(3);
    expect(onSignedIn).toHaveBeenCalledTimes(1);
    expect(onSignedIn).toHaveBeenCalledWith({ status: 'signed-in', csrfToken: 'csrf-1', mustChangePassword: false });

    // Signed in: no more requests.
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(completeCalls(fetchMock)).toHaveLength(3);
  });

  it('stops for good when this browser holds no usable grant', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(401, { code: 'SIGN_IN_GRANT_INVALID' }));
    vi.stubGlobal('fetch', fetchMock);
    const onSignedIn = vi.fn();
    render(<CheckEmailNotice email="rider@example.com" onSignedIn={onSignedIn} />);

    await act(() => vi.advanceTimersByTimeAsync(3_000));
    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000));

    expect(completeCalls(fetchMock)).toHaveLength(1);
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('stops for good on any other refusal that asking again cannot change', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(400, { code: 'EMAIL_REQUIRED' }));
    vi.stubGlobal('fetch', fetchMock);
    render(<CheckEmailNotice email="rider@example.com" onSignedIn={vi.fn()} />);

    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000));

    expect(completeCalls(fetchMock)).toHaveLength(1);
  });

  it('keeps going through a server error', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(503)).mockResolvedValue(SIGNED_IN);
    vi.stubGlobal('fetch', fetchMock);
    const onSignedIn = vi.fn();
    render(<CheckEmailNotice email="rider@example.com" onSignedIn={onSignedIn} />);

    await act(() => vi.advanceTimersByTimeAsync(6_000));

    expect(completeCalls(fetchMock)).toHaveLength(2);
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });

  it('waits while the tab is hidden, and asks the moment it is visible again', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(PENDING).mockResolvedValue(SIGNED_IN);
    vi.stubGlobal('fetch', fetchMock);
    const onSignedIn = vi.fn();
    render(<CheckEmailNotice email="rider@example.com" onSignedIn={onSignedIn} />);

    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(completeCalls(fetchMock)).toHaveLength(1);

    // The rider switches to their mail app.
    act(() => setVisibility('hidden'));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(completeCalls(fetchMock)).toHaveLength(1);

    // And comes back after opening the link.
    await act(async () => {
      setVisibility('visible');
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(completeCalls(fetchMock)).toHaveLength(2);
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });

  it('keeps going after a network error or rate limit, waiting at least as long as asked', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(reply(429, { details: { retryAfter: 20 } }))
      .mockResolvedValue(SIGNED_IN);
    vi.stubGlobal('fetch', fetchMock);
    const onSignedIn = vi.fn();
    render(<CheckEmailNotice email="rider@example.com" onSignedIn={onSignedIn} />);

    await act(() => vi.advanceTimersByTimeAsync(6_000));
    expect(completeCalls(fetchMock)).toHaveLength(2);

    await act(() => vi.advanceTimersByTimeAsync(19_000));
    expect(completeCalls(fetchMock)).toHaveLength(2);

    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(completeCalls(fetchMock)).toHaveLength(3);
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });

  it('stops asking once it unmounts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(PENDING);
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = render(<CheckEmailNotice email="rider@example.com" onSignedIn={vi.fn()} />);

    await act(() => vi.advanceTimersByTimeAsync(3_000));
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(60_000));

    expect(completeCalls(fetchMock)).toHaveLength(1);
  });

  it('does not ask at all without onSignedIn, and keeps the sign-in copy', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<CheckEmailNotice email="rider@example.com" />);

    await act(() => vi.advanceTimersByTimeAsync(60_000));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/then sign in/)).toBeInTheDocument();
  });
});

describe('emailSignInPollDelay', () => {
  it('asks often at first, then backs off', () => {
    expect(emailSignInPollDelay(0)).toBe(3_000);
    expect(emailSignInPollDelay(2 * 60_000 - 1)).toBe(3_000);
    expect(emailSignInPollDelay(2 * 60_000)).toBe(10_000);
    expect(emailSignInPollDelay(10 * 60_000)).toBe(30_000);
  });

  it('stops once the grant would have expired', () => {
    expect(emailSignInPollDelay(EMAIL_SIGN_IN_POLL_LIMIT_MS - 1)).toBe(30_000);
    expect(emailSignInPollDelay(EMAIL_SIGN_IN_POLL_LIMIT_MS)).toBeNull();
  });
});
