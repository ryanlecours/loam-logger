import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import VerifyEmail from './VerifyEmail';

const apollo = vi.hoisted(() => ({
  query: vi.fn().mockResolvedValue({ data: { me: { id: 'user_1' } } }),
  writeQuery: vi.fn(),
}));

vi.mock('@apollo/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@apollo/client')>()),
  useApolloClient: () => apollo,
}));

function LocationProbe() {
  const { pathname, search } = useLocation();
  return (
    <>
      <output data-testid="pathname">{pathname}</output>
      <output data-testid="search">{search}</output>
    </>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <VerifyEmail />
      <LocationProbe />
    </MemoryRouter>
  );
}

function reply(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function respond(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(reply(status, body));
}

type Reply = [status: number, body: unknown];

/**
 * Answers by endpoint: the verify call, then the sign-in grant exchange
 * (which answers 401 by default, as for a browser that holds no grant).
 */
function api({ verify, complete = [401, { code: 'SIGN_IN_GRANT_INVALID' }] }: { verify: Reply; complete?: Reply }) {
  return vi.fn(async (url: string) => {
    if (url.endsWith('/auth/verify-email/complete')) return reply(...complete);
    if (url.endsWith('/auth/verify-email')) return reply(...verify);
    throw new Error(`unexpected fetch ${url}`);
  });
}

const callsTo = (fetchMock: ReturnType<typeof vi.fn>, path: string) =>
  fetchMock.mock.calls.filter(([url]) => (url as string).endsWith(path));

function setUserAgent(ua: string) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
}

function setVisibility(state: 'visible' | 'hidden') {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
  document.dispatchEvent(new Event('visibilitychange'));
}

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
  document.querySelectorAll('iframe').forEach((f) => f.remove());
});

describe('VerifyEmail', () => {
  it('posts the token once on arrival and confirms the address', async () => {
    const fetchMock = api({ verify: [200, { ok: true, email: 'rider@example.com' }] });
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/verify-email?token=abc');

    expect(await screen.findByRole('heading', { name: 'Email confirmed' })).toBeInTheDocument();
    const verifyCalls = callsTo(fetchMock, '/auth/verify-email');
    expect(verifyCalls).toHaveLength(1);
    expect(verifyCalls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ token: 'abc' }) });
    expect(await screen.findByRole('button', { name: 'Go to Sign In' })).toBeInTheDocument();
  });

  it('drops the token from the URL once it has read it', async () => {
    vi.stubGlobal('fetch', api({ verify: [200, { ok: true }] }));
    renderAt('/verify-email?token=abc');

    await screen.findByRole('button', { name: 'Go to Sign In' });
    expect(screen.getByTestId('search')).toHaveTextContent(/^$/);
  });

  it('signs straight in when this browser holds a sign-in grant', async () => {
    const fetchMock = api({
      verify: [200, { ok: true, email: 'rider@example.com' }],
      complete: [200, { ok: true, mustChangePassword: false, csrfToken: 'csrf-1' }],
    });
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/verify-email?token=abc');

    await waitFor(() => expect(screen.getByTestId('pathname')).toHaveTextContent('/dashboard'));
    const [completeCall] = callsTo(fetchMock, '/auth/verify-email/complete');
    expect(completeCall[1]).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(sessionStorage.getItem('ll_csrf_cache')).toBe('csrf-1');
    expect(apollo.query).toHaveBeenCalled();
    expect(apollo.writeQuery).toHaveBeenCalled();
  });

  it('asks for the grant only after the link verified', async () => {
    const fetchMock = api({ verify: [400, { code: 'TOKEN_INVALID' }] });
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/verify-email?token=nope');

    await screen.findByRole('heading', { name: 'Link not valid' });
    expect(callsTo(fetchMock, '/auth/verify-email/complete')).toHaveLength(0);
  });

  it('prefills the sign-in form with the verified address when there is no grant', async () => {
    vi.stubGlobal('fetch', api({ verify: [200, { ok: true, email: 'rider+mtb@example.com' }] }));
    renderAt('/verify-email?token=abc');

    fireEvent.click(await screen.findByRole('button', { name: 'Go to Sign In' }));

    expect(screen.getByTestId('pathname')).toHaveTextContent('/login');
    expect(screen.getByTestId('search')).toHaveTextContent('?email=rider%2Bmtb%40example.com');
  });

  it('offers a new link when the token has expired', async () => {
    const fetchMock = respond(400, { code: 'TOKEN_EXPIRED' });
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/verify-email?token=old');

    expect(await screen.findByRole('heading', { name: 'Link expired' })).toBeInTheDocument();

    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'rider@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send a New Link' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toMatch(/\/auth\/resend-verification$/);
    expect(init).toMatchObject({ body: JSON.stringify({ email: 'rider@example.com' }) });
    expect(await screen.findByText(/a new link is on its way/)).toBeInTheDocument();
  });

  it('treats an invalid or superseded token as not valid', async () => {
    vi.stubGlobal('fetch', respond(400, { code: 'TOKEN_INVALID' }));
    renderAt('/verify-email?token=nope');

    expect(await screen.findByRole('heading', { name: 'Link not valid' })).toBeInTheDocument();
  });

  it('treats a link with no token as not valid without calling the API', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/verify-email');

    expect(screen.getByRole('heading', { name: 'Link not valid' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lets the rider retry after a network error', async () => {
    const working = api({ verify: [200, { ok: true }] });
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(working);
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/verify-email?token=abc');

    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));

    expect(await screen.findByRole('button', { name: 'Go to Sign In' })).toBeInTheDocument();
  });

  describe('opening the app from the email', () => {
    it('on a phone, tries the app first, then verifies here once the app did not open', async () => {
      setUserAgent(IPHONE);
      const fetchMock = api({ verify: [200, { ok: true }] });
      vi.stubGlobal('fetch', fetchMock);
      renderAt('/verify-email?token=abc&source=email');

      const iframe = document.querySelector('iframe');
      expect(iframe?.getAttribute('src')).toBe('loamlogger://verify-email?token=abc');
      expect(fetchMock).not.toHaveBeenCalled();

      await waitFor(() => expect(callsTo(fetchMock, '/auth/verify-email')).toHaveLength(1), { timeout: 3000 });
      expect(document.querySelector('iframe')).toBeNull();
    });

    it('when the app opens, verifies here too once the rider comes back', async () => {
      setUserAgent(IPHONE);
      const fetchMock = api({ verify: [200, { ok: true, alreadyVerified: true }] });
      vi.stubGlobal('fetch', fetchMock);
      renderAt('/verify-email?token=abc&source=email');

      setVisibility('hidden');
      await new Promise((r) => setTimeout(r, 1700));
      expect(fetchMock).not.toHaveBeenCalled();

      setVisibility('visible');
      await waitFor(() => expect(callsTo(fetchMock, '/auth/verify-email')).toHaveLength(1));
      expect(await screen.findByRole('button', { name: 'Go to Sign In' })).toBeInTheDocument();
    });

    it('on a desktop, verifies straight away without trying the app', async () => {
      setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15');
      const fetchMock = api({ verify: [200, { ok: true }] });
      vi.stubGlobal('fetch', fetchMock);
      renderAt('/verify-email?token=abc&source=email');

      expect(document.querySelector('iframe')).toBeNull();
      await waitFor(() => expect(callsTo(fetchMock, '/auth/verify-email')).toHaveLength(1));
    });

    it('never tries the app for a link that did not come from the email', async () => {
      setUserAgent(IPHONE);
      const fetchMock = api({ verify: [200, { ok: true }] });
      vi.stubGlobal('fetch', fetchMock);
      renderAt('/verify-email?token=abc');

      expect(document.querySelector('iframe')).toBeNull();
      await waitFor(() => expect(callsTo(fetchMock, '/auth/verify-email')).toHaveLength(1));
    });
  });
});
