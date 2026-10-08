import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import ProviderLinkModal from './ProviderLinkModal';
import { readPendingProviderLink } from '@/lib/providerLink';

const mockFetch = vi.fn();
const pending = { linkToken: 'link-t', email: 'rider@example.com', provider: 'google' as const };

function renderModal(onLinked = vi.fn(), onClose = vi.fn()) {
  render(
    <MemoryRouter>
      <ProviderLinkModal pending={pending} onClose={onClose} onLinked={onLinked} />
    </MemoryRouter>
  );
  return { onLinked, onClose };
}

function apiReturns(status: number, body: unknown) {
  mockFetch.mockResolvedValue({ ok: status < 400, status, json: async () => body });
}

function submitPassword(value: string) {
  fireEvent.change(screen.getByLabelText('Password'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect Google' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);
});

describe('ProviderLinkModal', () => {
  it('names the account and sends the link token with the password', async () => {
    apiReturns(200, { ok: true, csrfToken: 'csrf' });
    const { onLinked } = renderModal();

    expect(screen.getByText(/rider@example.com already has a Loam Logger password/)).toBeInTheDocument();
    submitPassword('right');

    await vi.waitFor(() => expect(onLinked).toHaveBeenCalledWith('csrf'));
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/auth\/link-provider$/);
    expect(JSON.parse(init.body)).toEqual({ linkToken: 'link-t', password: 'right' });
  });

  it('shows a wrong password without closing', async () => {
    apiReturns(401, { error: 'Incorrect password', code: 'UNAUTHORIZED' });
    const { onLinked } = renderModal();

    submitPassword('wrong');

    expect(await screen.findByText('Incorrect password')).toBeInTheDocument();
    expect(onLinked).not.toHaveBeenCalled();
  });

  it('asks for a fresh Google sign-in when the link token expired', async () => {
    apiReturns(400, { error: 'expired', code: 'LINK_EXPIRED' });
    renderModal();

    submitPassword('right');

    expect(await screen.findByText(/sign in with Google again/)).toBeInTheDocument();
  });
});

describe('readPendingProviderLink', () => {
  const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

  it('reads a held link from a 409', async () => {
    const res = response(409, {
      code: 'LINK_NEEDS_PASSWORD',
      details: { linkToken: 't', email: 'rider@example.com', provider: 'google' },
    });

    await expect(readPendingProviderLink(res)).resolves.toEqual({
      linkToken: 't',
      email: 'rider@example.com',
      provider: 'google',
    });
    // The body is still readable for the caller's own error handling.
    await expect(res.text()).resolves.toContain('LINK_NEEDS_PASSWORD');
  });

  it('ignores other failures', async () => {
    await expect(readPendingProviderLink(response(401, { code: 'PROVIDER_EMAIL_UNVERIFIED' }))).resolves.toBeNull();
    await expect(readPendingProviderLink(response(409, { code: 'CONFLICT' }))).resolves.toBeNull();
  });
});
