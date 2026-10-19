import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import VerifyEmail from './VerifyEmail';

function LocationProbe() {
  const { search } = useLocation();
  return <output data-testid="search">{search}</output>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <VerifyEmail />
      <LocationProbe />
    </MemoryRouter>
  );
}

function respond(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
}

afterEach(() => vi.unstubAllGlobals());

describe('VerifyEmail', () => {
  it('posts the token once on arrival and confirms the address', async () => {
    const fetchMock = respond(200, { ok: true });
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/verify-email?token=abc');

    expect(await screen.findByRole('heading', { name: 'Email confirmed' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/auth\/verify-email$/);
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ token: 'abc' }) });
    expect(screen.getByRole('button', { name: 'Go to Sign In' })).toBeInTheDocument();
  });

  it('drops the token from the URL once it has read it', async () => {
    vi.stubGlobal('fetch', respond(200, { ok: true }));
    renderAt('/verify-email?token=abc');

    await screen.findByRole('heading', { name: 'Email confirmed' });
    expect(screen.getByTestId('search')).toHaveTextContent(/^$/);
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
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/verify-email?token=abc');

    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();

    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));

    expect(await screen.findByRole('heading', { name: 'Email confirmed' })).toBeInTheDocument();
  });
});
