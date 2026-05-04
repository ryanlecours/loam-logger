import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { UsersSection } from './UsersSection';

vi.mock('@/lib/csrf', () => ({
  getAuthHeaders: () => ({ 'x-csrf-token': 'test-csrf' }),
}));

vi.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({
    user: { id: 'self-id', role: 'ADMIN' },
    loading: false,
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Bypass the Modal portal so confirm modals are visible to RTL queries
// without juggling createPortal in jsdom.
vi.mock('../../../components/ui/Modal', () => ({
  Modal: ({
    isOpen,
    title,
    children,
    footer,
  }: {
    isOpen: boolean;
    title?: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) =>
    isOpen ? (
      <div data-testid="modal">
        {title && <h2>{title}</h2>}
        {children}
        {footer && <div data-testid="modal-footer">{footer}</div>}
      </div>
    ) : null,
}));

vi.mock('../../../components/ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    type,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    type?: 'button' | 'submit';
  }) => (
    <button onClick={onClick} disabled={disabled} type={type ?? 'button'}>
      {children}
    </button>
  ),
}));

const originalFetch = globalThis.fetch;
const fetchMock = vi.fn();
const originalConfirm = window.confirm;

const baseUser = {
  id: 'user-1',
  email: 'rider@example.com',
  name: 'Test Rider',
  role: 'PRO' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  activatedAt: '2026-02-01T00:00:00.000Z',
  emailUnsubscribed: false,
  isFoundingRider: false,
  lastPasswordResetEmailAt: null,
};

function userListResponse(users: Array<Partial<typeof baseUser>>) {
  return new Response(
    JSON.stringify({
      users: users.map((u) => ({ ...baseUser, ...u })),
      pagination: { page: 1, totalPages: 1 },
    }),
    { status: 200 },
  );
}

beforeEach(() => {
  globalThis.fetch = fetchMock;
  fetchMock.mockReset();
  window.confirm = vi.fn(() => true);
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  window.confirm = originalConfirm;
});

describe('UsersSection', () => {
  it('renders an active user row with the role badge after the initial fetch', async () => {
    fetchMock.mockResolvedValueOnce(userListResponse([{}]));

    render(<UsersSection />);

    expect(await screen.findByText('rider@example.com')).toBeInTheDocument();
    expect(screen.getByText('Test Rider')).toBeInTheDocument();
    expect(screen.getByText('PRO')).toBeInTheDocument();

    // Initial fetch call: GET on /api/admin/users with page=1 and credentials.
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/api/admin/users');
    expect(url).toContain('page=1');
  });

  it('shows the empty state when no users come back', async () => {
    fetchMock.mockResolvedValueOnce(userListResponse([]));
    render(<UsersSection />);

    expect(await screen.findByText('No active users yet.')).toBeInTheDocument();
  });

  it('disables Demote and Delete on the current admin own row', async () => {
    fetchMock.mockResolvedValueOnce(userListResponse([{ id: 'self-id' }]));
    render(<UsersSection />);

    const row = (await screen.findByText('rider@example.com')).closest('tr');
    expect(row).toBeTruthy();
    if (!row) return;

    const within_ = within(row);
    expect(within_.getByRole('button', { name: 'Demote' })).toBeDisabled();
    expect(within_.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });

  it('opens a typed-confirm delete modal and only fires DELETE after the email matches', async () => {
    // First call: list. Second call: DELETE.
    fetchMock.mockResolvedValueOnce(userListResponse([{}]));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    render(<UsersSection />);

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    // Confirm modal title shows up. Scope the confirm-button lookup to the
    // modal footer — the modal title is also "Delete user" so a top-level
    // text query would return both.
    const modal = await screen.findByTestId('modal');
    expect(within(modal).getByRole('heading', { name: 'Delete user' })).toBeInTheDocument();
    const footer = screen.getByTestId('modal-footer');
    const confirmBtn = within(footer).getByRole('button', { name: 'Delete user' });
    expect(confirmBtn).toBeDisabled();

    // Wrong typed value — still disabled.
    const input = screen.getByPlaceholderText('rider@example.com');
    fireEvent.change(input, { target: { value: 'wrong@example.com' } });
    expect(confirmBtn).toBeDisabled();
    // Sanity check: no DELETE fired.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Right typed value — enables; click fires the DELETE.
    fireEvent.change(input, { target: { value: 'rider@example.com' } });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      const lastCall = fetchMock.mock.calls.at(-1);
      expect(lastCall?.[0]).toContain('/api/admin/users/user-1');
      expect(lastCall?.[1]).toMatchObject({ method: 'DELETE' });
    });

    // After success, the row is removed locally.
    await waitFor(() => {
      expect(screen.queryByText('rider@example.com')).not.toBeInTheDocument();
    });
  });

  it('confirms before demoting and POSTs to the demote endpoint', async () => {
    fetchMock.mockResolvedValueOnce(userListResponse([{}]));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

    render(<UsersSection />);

    fireEvent.click(await screen.findByRole('button', { name: 'Demote' }));

    // ConfirmDeleteModal opens (warning tone, no typed-confirm). Scope the
    // confirm click to the modal footer — there are two "Demote" buttons
    // visible at this point (the still-rendered row button + the modal
    // confirm), so an unscoped getByRole would throw.
    expect(await screen.findByText('Demote to waitlist')).toBeInTheDocument();
    const footer = screen.getByTestId('modal-footer');
    fireEvent.click(within(footer).getByRole('button', { name: 'Demote' }));

    await waitFor(() => {
      const lastCall = fetchMock.mock.calls.at(-1);
      expect(lastCall?.[0]).toContain('/api/admin/users/user-1/demote');
      expect(lastCall?.[1]).toMatchObject({ method: 'POST' });
    });
  });
});
