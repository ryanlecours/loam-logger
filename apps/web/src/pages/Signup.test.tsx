import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import Signup from './Signup';
import { TURNSTILE_SCRIPT_SRC, type TurnstileRenderOptions } from '@/lib/turnstile';

vi.mock('@react-oauth/google', () => ({
  GoogleLogin: () => null,
}));

vi.mock('@apollo/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@apollo/client')>()),
  useApolloClient: () => ({ query: vi.fn(), writeQuery: vi.fn() }),
}));

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function fillAndSubmit() {
  fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Rider' } });
  fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'new@example.com' } });
  fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), { target: { value: 'StrongPassw0rd!' } });
  fireEvent.change(screen.getByPlaceholderText('Re-enter password'), { target: { value: 'StrongPassw0rd!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  return JSON.parse(fetchMock.mock.calls[call][1].body as string);
}

const turnstile = {
  render: vi.fn<(el: HTMLElement, opts: TurnstileRenderOptions) => string>(),
  reset: vi.fn(),
  remove: vi.fn(),
};

/** The options Signup passed to turnstile.render, once the widget mounted. */
async function renderedWidget(): Promise<TurnstileRenderOptions> {
  await waitFor(() => expect(turnstile.render).toHaveBeenCalled());
  return turnstile.render.mock.calls[0][1];
}

beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  turnstile.render.mockReset().mockReturnValue('widget-1');
  turnstile.reset.mockReset();
  turnstile.remove.mockReset();
  window.turnstile = turnstile;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete window.turnstile;
});

describe('Signup with Turnstile', () => {
  beforeEach(() => vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key-123'));

  it('renders the dark, interaction-only widget for the signup action', async () => {
    render(<MemoryRouter><Signup /></MemoryRouter>);

    const options = await renderedWidget();
    expect(turnstile.render.mock.calls[0][0]).toBe(screen.getByTestId('turnstile-widget'));
    expect(options).toMatchObject({
      sitekey: 'site-key-123',
      action: 'signup',
      theme: 'dark',
      appearance: 'interaction-only',
    });
  });

  it('sends the widget token with the signup request', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(201, { ok: true, verificationRequired: true, email: 'new@example.com' }));
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter><Signup /></MemoryRouter>);

    const options = await renderedWidget();
    act(() => options.callback?.('tok-abc'));
    fillAndSubmit();

    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/auth\/signup$/);
    expect(sentBody(fetchMock)).toEqual({
      email: 'new@example.com',
      name: 'Rider',
      password: 'StrongPassw0rd!',
      turnstileToken: 'tok-abc',
    });
    // Leaving the form removes the widget.
    await waitFor(() => expect(turnstile.remove).toHaveBeenCalledWith('widget-1'));
  });

  it('resets the widget after a refused signup and sends the next token on retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { message: 'Too many signup attempts. Please try again later.' }))
      .mockResolvedValueOnce(jsonResponse(201, { ok: true, verificationRequired: true, email: 'new@example.com' }));
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter><Signup /></MemoryRouter>);

    const options = await renderedWidget();
    act(() => options.callback?.('tok-first'));
    fillAndSubmit();

    expect(await screen.findByText('Too many signup attempts. Please try again later.')).toBeInTheDocument();
    expect(turnstile.reset).toHaveBeenCalledWith('widget-1');
    expect(sentBody(fetchMock, 0).turnstileToken).toBe('tok-first');

    act(() => options.callback?.('tok-second'));
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(sentBody(fetchMock, 1).turnstileToken).toBe('tok-second');
  });

  it('waits for a token still being solved, then sends it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(201, { ok: true, verificationRequired: true, email: 'new@example.com' }));
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter><Signup /></MemoryRouter>);

    const options = await renderedWidget();
    fillAndSubmit();

    expect(await screen.findByRole('button', { name: 'Verifying...' })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => options.callback?.('tok-late'));

    await screen.findByRole('heading', { name: 'Check your email' });
    expect(sentBody(fetchMock).turnstileToken).toBe('tok-late');
  });

  it('sends one request when the form is submitted twice during the wait', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(201, { ok: true, verificationRequired: true, email: 'new@example.com' }));
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter><Signup /></MemoryRouter>);

    const options = await renderedWidget();
    fillAndSubmit();
    // Straight at the form, as Enter in a field would, past the disabled button.
    fireEvent.submit(screen.getByRole('button', { name: 'Verifying...' }).closest('form')!);
    act(() => options.callback?.('tok-once'));

    await screen.findByRole('heading', { name: 'Check your email' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not resend a token that expired, and waits for the fresh one', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(201, { ok: true, verificationRequired: true, email: 'new@example.com' }));
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter><Signup /></MemoryRouter>);

    const options = await renderedWidget();
    act(() => options.callback?.('tok-old'));
    act(() => options['expired-callback']?.());
    fillAndSubmit();
    await screen.findByRole('button', { name: 'Verifying...' });
    act(() => options.callback?.('tok-new'));

    await screen.findByRole('heading', { name: 'Check your email' });
    expect(sentBody(fetchMock).turnstileToken).toBe('tok-new');
  });

  it('gives up waiting after a while and signs up without a token', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse(201, { ok: true, verificationRequired: true, email: 'new@example.com' }));
      vi.stubGlobal('fetch', fetchMock);
      render(<MemoryRouter><Signup /></MemoryRouter>);

      await renderedWidget();
      fillAndSubmit();
      await screen.findByRole('button', { name: 'Verifying...' });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8000);
      });

      await screen.findByRole('heading', { name: 'Check your email' });
      expect(sentBody(fetchMock)).not.toHaveProperty('turnstileToken');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not wait when the Turnstile script cannot load', async () => {
    delete window.turnstile;
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(201, { ok: true, verificationRequired: true, email: 'new@example.com' }));
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter><Signup /></MemoryRouter>);

    const script = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT_SRC}"]`);
    expect(script).not.toBeNull();
    act(() => script!.onerror?.(new Event('error')));
    fillAndSubmit();

    await screen.findByRole('heading', { name: 'Check your email' });
    expect(screen.queryByRole('button', { name: 'Verifying...' })).not.toBeInTheDocument();
    expect(sentBody(fetchMock)).not.toHaveProperty('turnstileToken');
  });
});

describe('Signup without a Turnstile site key', () => {
  it('shows no widget, loads no script and sends no token', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');
    delete window.turnstile;
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(201, { ok: true, verificationRequired: true, email: 'new@example.com' }));
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter><Signup /></MemoryRouter>);

    fillAndSubmit();

    await screen.findByRole('heading', { name: 'Check your email' });
    expect(screen.queryByTestId('turnstile-widget')).not.toBeInTheDocument();
    expect(document.querySelector(`script[src="${TURNSTILE_SCRIPT_SRC}"]`)).toBeNull();
    expect(sentBody(fetchMock)).not.toHaveProperty('turnstileToken');
  });
});

describe('Signup waiting on the verification email', () => {
  function OnboardingProbe() {
    return <p>Onboarding</p>;
  }

  it('signs this browser in and goes to onboarding once the link is opened anywhere', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');
    delete window.turnstile;
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<ReturnType<typeof jsonResponse>>>(async (url) => {
      if (url.endsWith('/auth/signup')) {
        return jsonResponse(201, { ok: true, verificationRequired: true, email: 'new@example.com' });
      }
      if (url.endsWith('/auth/verify-email/complete')) {
        return jsonResponse(200, { ok: true, mustChangePassword: false, csrfToken: 'csrf-1' });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter initialEntries={['/signup']}>
        <Routes>
          <Route path="/signup" element={<Signup />} />
          <Route path="/onboarding" element={<OnboardingProbe />} />
        </Routes>
      </MemoryRouter>
    );

    fillAndSubmit();
    await screen.findByRole('heading', { name: 'Check your email' });

    expect(await screen.findByText('Onboarding', {}, { timeout: 5000 })).toBeInTheDocument();
    const completeCall = fetchMock.mock.calls.find(([url]) => url.endsWith('/auth/verify-email/complete'));
    expect(completeCall?.[1]).toMatchObject({ method: 'POST', credentials: 'include' });
  });
});
