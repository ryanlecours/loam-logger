import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import Login from './Login';
import Signup from './Signup';

const apolloQuery = vi.fn();

vi.mock('@react-oauth/google', () => ({
  GoogleLogin: () => null,
}));

vi.mock('@apollo/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@apollo/client')>()),
  useApolloClient: () => ({ query: apolloQuery, writeQuery: vi.fn() }),
}));

function renderAt(ui: React.ReactElement, path: string) {
  return render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
}

function jsonResponse(status: number, body: unknown) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: async () => body,
    text: async () => text,
  };
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
  apolloQuery.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('Signup with email verification', () => {
  it('shows the check-your-email notice instead of signing in', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(201, { ok: true, verificationRequired: true, email: 'new@example.com' }));
    vi.stubGlobal('fetch', fetchMock);
    renderAt(<Signup />, '/signup');

    fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Rider' } });
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), { target: { value: 'StrongPassw0rd!' } });
    fireEvent.change(screen.getByPlaceholderText('Re-enter password'), { target: { value: 'StrongPassw0rd!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByText('new@example.com')).toBeInTheDocument();
    // No session exists yet, so nothing asks for the current user.
    expect(apolloQuery).not.toHaveBeenCalled();
  });

  it('resends the link from the notice', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(201, { ok: true, verificationRequired: true, email: 'new@example.com' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    renderAt(<Signup />, '/signup');

    fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Rider' } });
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), { target: { value: 'StrongPassw0rd!' } });
    fireEvent.change(screen.getByPlaceholderText('Re-enter password'), { target: { value: 'StrongPassw0rd!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send a new link' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toMatch(/\/auth\/resend-verification$/);
    expect(init).toMatchObject({ body: JSON.stringify({ email: 'new@example.com' }) });
    expect(await screen.findByText(/A new link is on its way/)).toBeInTheDocument();
  });
});

describe('Signup with a taken email', () => {
  it('points to log in and password reset when the API answers EMAIL_EXISTS', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(409, {
          error: 'An account with this email already exists. Please log in.',
          code: 'EMAIL_EXISTS',
        })
      )
    );
    renderAt(<Signup />, '/signup');

    fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Rider' } });
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'taken@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), { target: { value: 'StrongPassw0rd!' } });
    fireEvent.change(screen.getByPlaceholderText('Re-enter password'), { target: { value: 'StrongPassw0rd!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(await screen.findByRole('link', { name: 'Reset password' })).toHaveAttribute('href', '/forgot-password');
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
  });
});

describe('Login with email verification', () => {
  it('shows the check-your-email notice when the account is not verified yet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(403, {
          error: 'Check your inbox for a link to verify your email, then sign in.',
          code: 'EMAIL_VERIFICATION_REQUIRED',
          details: { email: 'rider@example.com' },
        })
      )
    );
    renderAt(<Login />, '/login');

    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'rider@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('********'), { target: { value: 'StrongPassw0rd!' } });
    fireEvent.submit(screen.getByPlaceholderText('********').closest('form') as HTMLFormElement);

    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(apolloQuery).not.toHaveBeenCalled();

    // Back to Sign In returns to the form.
    fireEvent.click(screen.getByRole('button', { name: 'Back to Sign In' }));
    expect(screen.getByPlaceholderText('********')).toBeInTheDocument();
  });

  it('shows the API error text for other failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(401, { error: 'Invalid email or password' }))
    );
    renderAt(<Login />, '/login');

    fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'rider@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('********'), { target: { value: 'wrong' } });
    fireEvent.submit(screen.getByPlaceholderText('********').closest('form') as HTMLFormElement);

    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument();
  });
});
