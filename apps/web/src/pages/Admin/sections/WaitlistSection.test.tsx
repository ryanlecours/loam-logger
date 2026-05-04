import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { WaitlistSection } from './WaitlistSection';
import { AdminStatsProvider } from '../AdminStatsProvider';

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

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

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

const baseEntry = {
  id: 'entry-1',
  email: 'beta@example.com',
  name: 'Beta Tester',
  referrer: null,
  createdAt: '2026-04-01T00:00:00.000Z',
  emailUnsubscribed: false,
  isFoundingRider: false,
};

function waitlistResponse(entries: Array<Partial<typeof baseEntry>>) {
  return new Response(
    JSON.stringify({
      entries: entries.map((e) => ({ ...baseEntry, ...e })),
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
// AdminStatsProvider's stats fetch and the section's list fetch fire,
// and tolerant of post-mutation `refreshStats()` calls.
function setupFetchHandlers(
  handlers: Partial<{
    waitlist: () => Response;
    stats: () => Response;
    activate: () => Response;
    delete: () => Response;
    foundingRider: () => Response;
    bulkFoundingRider: () => Response;
  }>,
) {
  fetchMock.mockImplementation(async (input: string, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/api/admin/stats')) return handlers.stats?.() ?? statsResponse();
    if (url.includes('/api/admin/waitlist') && method === 'GET')
      return handlers.waitlist?.() ?? waitlistResponse([]);
    if (url.includes('/api/admin/activate/')) return handlers.activate?.() ?? new Response(null, { status: 200 });
    if (url.match(/\/waitlist\/[^/]+$/) && method === 'DELETE')
      return handlers.delete?.() ?? new Response(null, { status: 204 });
    if (url.includes('founding-rider/bulk'))
      return handlers.bulkFoundingRider?.() ?? new Response(JSON.stringify({ updatedCount: 0 }), { status: 200 });
    if (url.includes('/founding-rider'))
      return handlers.foundingRider?.() ?? new Response(null, { status: 200 });
    throw new Error(`Unhandled fetch: ${method} ${url}`);
  });
}

describe('WaitlistSection', () => {
  it('renders waitlist entries from /api/admin/waitlist', async () => {
    setupFetchHandlers({
      waitlist: () =>
        waitlistResponse([{}, { id: 'entry-2', email: 'second@example.com' }]),
    });

    renderInProvider(<WaitlistSection />);

    expect(await screen.findByText('beta@example.com')).toBeInTheDocument();
    expect(screen.getByText('second@example.com')).toBeInTheDocument();

    const waitlistCall = fetchMock.mock.calls.find(
      (call) => String(call[0]).includes('/api/admin/waitlist') && String(call[0]).includes('page=1'),
    );
    expect(waitlistCall).toBeDefined();
  });

  it('shows the empty state when no entries are returned', async () => {
    setupFetchHandlers({ waitlist: () => waitlistResponse([]) });
    renderInProvider(<WaitlistSection />);

    expect(await screen.findByText('No waitlist entries yet.')).toBeInTheDocument();
  });

  it('toggles founding-rider via PATCH and updates the local row state', async () => {
    setupFetchHandlers({
      waitlist: () => waitlistResponse([{ isFoundingRider: false }]),
    });

    renderInProvider(<WaitlistSection />);

    // The toggle button shows "No" when not a founding rider.
    const toggle = await screen.findByRole('button', { name: 'No' });
    fireEvent.click(toggle);

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        (call) =>
          String(call[0]).includes('/api/admin/users/entry-1/founding-rider') &&
          (call[1] as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(patchCall).toBeDefined();
      expect(JSON.parse((patchCall![1] as RequestInit).body as string)).toEqual({
        isFoundingRider: true,
      });
    });

    // Optimistic update flips the pill label to "Yes".
    expect(await screen.findByRole('button', { name: 'Yes' })).toBeInTheDocument();
    // Confirm gate fired exactly once for this single-row toggle.
    expect(window.confirm).toHaveBeenCalledOnce();
  });

  it('does NOT fire PATCH if the user dismisses the founding-rider confirm', async () => {
    // Regression test: the toggle pill sits in a dense row and is easy to
    // mis-tap, so the old Admin.tsx confirmed before toggling. This test
    // pins that the gate stays in place — a future contributor removing
    // the confirm() would have to update this assertion.
    setupFetchHandlers({
      waitlist: () => waitlistResponse([{ isFoundingRider: false }]),
    });
    window.confirm = vi.fn(() => false);

    renderInProvider(<WaitlistSection />);

    const toggle = await screen.findByRole('button', { name: 'No' });
    fireEvent.click(toggle);

    expect(window.confirm).toHaveBeenCalledOnce();
    const patches = fetchMock.mock.calls.filter(
      (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patches).toHaveLength(0);
  });

  it('opens a confirm modal for delete and only fires DELETE on confirm', async () => {
    setupFetchHandlers({ waitlist: () => waitlistResponse([{}]) });

    renderInProvider(<WaitlistSection />);

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    // Modal title; scope confirm click to the footer to avoid the still-mounted
    // row Delete button matching the same accessible name.
    expect(await screen.findByText('Remove from waitlist')).toBeInTheDocument();
    const footer = screen.getByTestId('modal-footer');
    fireEvent.click(within(footer).getByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      const deleteCall = fetchMock.mock.calls.find(
        (call) =>
          String(call[0]).includes('/api/admin/waitlist/entry-1') &&
          (call[1] as RequestInit | undefined)?.method === 'DELETE',
      );
      expect(deleteCall).toBeDefined();
    });
  });

  it('Activate opens a styled confirm modal and POSTs only on confirm', async () => {
    // Activation goes through ConfirmDeleteModal (warning tone) — it
    // provisions a real account + sends a transactional email, so it
    // shouldn't ride on a native window.confirm. Pin the modal flow.
    setupFetchHandlers({ waitlist: () => waitlistResponse([{}]) });

    renderInProvider(<WaitlistSection />);

    fireEvent.click(await screen.findByRole('button', { name: 'Activate' }));

    expect(await screen.findByText('Activate user')).toBeInTheDocument();
    // No POST yet — only the initial GET should have fired.
    expect(
      fetchMock.mock.calls.filter(
        (call) => (call[1] as RequestInit | undefined)?.method === 'POST',
      ),
    ).toHaveLength(0);

    const footer = screen.getByTestId('modal-footer');
    fireEvent.click(within(footer).getByRole('button', { name: 'Activate' }));

    await waitFor(() => {
      const activateCall = fetchMock.mock.calls.find(
        (call) =>
          String(call[0]).includes('/api/admin/activate/entry-1') &&
          (call[1] as RequestInit | undefined)?.method === 'POST',
      );
      expect(activateCall).toBeDefined();
    });

    // The window.confirm is no longer used for activation — it's only
    // used for the founding-rider toggle in this section now.
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('refreshes admin stats after a successful activate', async () => {
    // Activate moves the row out of the waitlist and into /api/admin/users —
    // both userCount and waitlistCount in the Overview header shift. Pin
    // that the post-activate path triggers a stats refresh.
    setupFetchHandlers({ waitlist: () => waitlistResponse([{}]) });

    renderInProvider(<WaitlistSection />);
    await screen.findByText('beta@example.com');

    const statsBefore = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes('/api/admin/stats'),
    ).length;

    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
    const footer = screen.getByTestId('modal-footer');
    fireEvent.click(within(footer).getByRole('button', { name: 'Activate' }));

    await waitFor(() => {
      const statsAfter = fetchMock.mock.calls.filter((call) =>
        String(call[0]).includes('/api/admin/stats'),
      ).length;
      expect(statsAfter).toBeGreaterThan(statsBefore);
    });
  });
});
