import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import VerifyEmail from './VerifyEmail';

const mockRefetchQueries = vi.fn().mockResolvedValue([]);
vi.mock('@apollo/client', () => ({
  useApolloClient: () => ({ refetchQueries: mockRefetchQueries }),
}));

const mockFetch = vi.fn();

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <VerifyEmail />
    </MemoryRouter>
  );
}

function apiReturns(status: number, body: unknown) {
  mockFetch.mockResolvedValue({ ok: status < 400, status, json: async () => body });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);
});

describe('VerifyEmail', () => {
  it('posts the token once and shows success', async () => {
    apiReturns(200, { ok: true });

    renderAt('/verify-email?token=abc');

    expect(await screen.findByText('Email confirmed')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/auth\/verify-email$/);
    expect(JSON.parse(init.body)).toEqual({ token: 'abc' });
    await waitFor(() => expect(mockRefetchQueries).toHaveBeenCalled());
  });

  it('explains an expired link', async () => {
    apiReturns(400, { code: 'TOKEN_EXPIRED' });

    renderAt('/verify-email?token=abc');

    expect(await screen.findByText('Link expired')).toBeInTheDocument();
  });

  it('explains an invalid link', async () => {
    apiReturns(400, { code: 'TOKEN_INVALID' });

    renderAt('/verify-email?token=abc');

    expect(await screen.findByText('Link not recognized')).toBeInTheDocument();
  });

  it('does not call the API without a token', () => {
    renderAt('/verify-email');

    expect(screen.getByText('Link not recognized')).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
