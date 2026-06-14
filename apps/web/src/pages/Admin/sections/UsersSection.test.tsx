import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { UsersSection } from './UsersSection';
import { AdminStatsProvider } from '../AdminStatsProvider';

// UsersSection now consumes the AdminStats context to refresh Overview
// counts after delete/demote/add. Wrap renders in the provider — its
// initial /api/admin/stats fetch fires once per mount, so each test queues
// a stats response BEFORE the user-list response (the order of fetchMock
// calls follows the order of side-effect chains in the providers/sections).
function renderInProvider(ui: React.ReactElement) {
  return render(<AdminStatsProvider>{ui}</AdminStatsProvider>);
}

function statsResponse() {
  return new Response(
    JSON.stringify({ users: 0, waitlist: 0, foundingRiders: 0 }),
    { status: 200 },
  );
}

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

// URL-based fetch dispatch — independent of the order in which the
// provider's stats fetch and the section's list fetch fire (React effect
// ordering can vary), and tolerant of post-mutation `refreshStats()` calls
// without each test having to enumerate every chained response.
function setupFetchHandlers(
  handlers: Partial<{
    users: () => Response;
    waitlist: () => Response;
    stats: () => Response;
    delete: () => Response;
    addUser: () => Response;
    sendReset: () => Response;
  }>,
) {
  fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/api/admin/stats')) return handlers.stats?.() ?? statsResponse();
    if (url.includes('/api/admin/users') && method === 'GET') return handlers.users?.() ?? userListResponse([]);
    if (url.match(/\/users\/[^/]+$/) && method === 'DELETE')
      return handlers.delete?.() ?? new Response(null, { status: 204 });
    if (url.includes('/api/admin/users') && method === 'POST')
      return handlers.addUser?.() ?? new Response(JSON.stringify({}), { status: 200 });
    if (url.includes('send-password-reset'))
      return handlers.sendReset?.() ?? new Response(null, { status: 200 });
    throw new Error(`Unhandled fetch: ${method} ${url}`);
  });
}

describe('UsersSection', () => {
  it('renders an active user row with the role badge after the initial fetch', async () => {
    setupFetchHandlers({ users: () => userListResponse([{}]) });

    renderInProvider(<UsersSection />);

    expect(await screen.findByText('rider@example.com')).toBeInTheDocument();
    expect(screen.getByText('Test Rider')).toBeInTheDocument();
    expect(screen.getByText('PRO')).toBeInTheDocument();

    // Pin that the user-list fetch was made with the expected paging param.
    // Use a `find` rather than positional indexing because the provider's
    // stats fetch races with the section's user-list fetch and either may
    // come first in `fetchMock.mock.calls`.
    const userListCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes('/api/admin/users') && String(call[0]).includes('page=1'),
    );
    expect(userListCall).toBeDefined();
  });

  it('shows the empty state when no users come back', async () => {
    setupFetchHandlers({ users: () => userListResponse([]) });
    renderInProvider(<UsersSection />);

    expect(await screen.findByText('No active users yet.')).toBeInTheDocument();
  });

  it('disables Delete on the current admin own row', async () => {
    setupFetchHandlers({ users: () => userListResponse([{ id: 'self-id' }]) });
    renderInProvider(<UsersSection />);

    const row = (await screen.findByText('rider@example.com')).closest('tr');
    expect(row).toBeTruthy();
    if (!row) return;

    const within_ = within(row);
    expect(within_.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });

  it('opens a typed-confirm delete modal and only fires DELETE after the email matches', async () => {
    setupFetchHandlers({ users: () => userListResponse([{}]) });

    renderInProvider(<UsersSection />);

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    // Confirm modal title shows up. Scope the confirm-button lookup to the
    // modal footer — the modal title is also "Delete user" so a top-level
    // text query would return both.
    const modal = await screen.findByTestId('modal');
    expect(within(modal).getByRole('heading', { name: 'Delete user' })).toBeInTheDocument();
    const footer = screen.getByTestId('modal-footer');
    const confirmBtn = within(footer).getByRole('button', { name: 'Delete user' });
    expect(confirmBtn).toBeDisabled();

    const findDeleteCall = () =>
      fetchMock.mock.calls.find(
        (call) =>
          String(call[0]).match(/\/users\/user-1$/) &&
          (call[1] as RequestInit | undefined)?.method === 'DELETE',
      );

    // Wrong typed value — still disabled, no DELETE fired.
    const input = screen.getByPlaceholderText('rider@example.com');
    fireEvent.change(input, { target: { value: 'wrong@example.com' } });
    expect(confirmBtn).toBeDisabled();
    expect(findDeleteCall()).toBeUndefined();

    // Right typed value — enables; click fires the DELETE.
    fireEvent.change(input, { target: { value: 'rider@example.com' } });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(findDeleteCall()).toBeDefined();
    });

    // After success, the row is removed locally.
    await waitFor(() => {
      expect(screen.queryByText('rider@example.com')).not.toBeInTheDocument();
    });
  });

  it('refreshes admin stats after a successful delete', async () => {
    // Cross-section coupling: deleting from /api/admin/users shifts the
    // userCount in the Overview header. Pin that the post-delete success
    // path triggers a stats refresh — without this, an admin landing on
    // Overview after a delete spree would see stale counters.
    setupFetchHandlers({ users: () => userListResponse([{}]) });

    renderInProvider(<UsersSection />);
    await screen.findByText('rider@example.com');

    // Snapshot the count of stats fetches before the mutation so we can
    // assert that another one fires after.
    const statsBefore = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes('/api/admin/stats'),
    ).length;

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const footer = screen.getByTestId('modal-footer');
    const input = screen.getByPlaceholderText('rider@example.com');
    fireEvent.change(input, { target: { value: 'rider@example.com' } });
    fireEvent.click(within(footer).getByRole('button', { name: 'Delete user' }));

    await waitFor(() => {
      const statsAfter = fetchMock.mock.calls.filter((call) =>
        String(call[0]).includes('/api/admin/stats'),
      ).length;
      expect(statsAfter).toBeGreaterThan(statsBefore);
    });
  });
});
