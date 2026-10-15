import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import DeleteAccountConfirm from './DeleteAccountConfirm';

function stubObserver() {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DeleteAccountConfirm />
    </MemoryRouter>
  );
}

function respond(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
}

beforeEach(stubObserver);
afterEach(() => vi.unstubAllGlobals());

describe('DeleteAccountConfirm', () => {
  it('deletes nothing on arrival: it waits for the button', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/delete-account/confirm?token=abc');

    expect(screen.getByRole('heading', { name: 'Delete your Loam Logger account?' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a link with no token as invalid', () => {
    renderAt('/delete-account/confirm');
    expect(screen.getByRole('heading', { name: "This link doesn't work" })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('posts the token without credentials and confirms the deletion', async () => {
    const fetchMock = respond(200, { ok: true });
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/delete-account/confirm?token=abc');

    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));

    expect(await screen.findByRole('heading', { name: 'Your account has been deleted' })).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/auth\/delete-account\/confirm$/);
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ token: 'abc' }) });
    expect(init.credentials).toBeUndefined();
  });

  it('shows the expired state for TOKEN_EXPIRED', async () => {
    vi.stubGlobal('fetch', respond(400, { code: 'TOKEN_EXPIRED' }));
    renderAt('/delete-account/confirm?token=abc');

    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));

    expect(await screen.findByRole('heading', { name: 'This link has expired' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '/delete-account#by-email');
  });

  it('shows the invalid state for TOKEN_INVALID', async () => {
    vi.stubGlobal('fetch', respond(400, { code: 'TOKEN_INVALID' }));
    renderAt('/delete-account/confirm?token=abc');

    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));

    expect(await screen.findByRole('heading', { name: "This link doesn't work" })).toBeInTheDocument();
  });

  it("shows the API's message and keeps the button when billing cancellation fails", async () => {
    const message = "We couldn't cancel your Loam Logger Pro subscription, so your account has not been deleted. Please try again in a few minutes.";
    vi.stubGlobal('fetch', respond(503, { error: message, code: 'BILLING_CANCELLATION_FAILED' }));
    renderAt('/delete-account/confirm?token=abc');

    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeEnabled();
  });
});
