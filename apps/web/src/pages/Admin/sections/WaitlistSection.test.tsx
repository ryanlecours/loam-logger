import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { WaitlistSection } from './WaitlistSection';

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

describe('WaitlistSection', () => {
  it('renders waitlist entries from /api/admin/waitlist', async () => {
    fetchMock.mockResolvedValueOnce(
      waitlistResponse([{}, { id: 'entry-2', email: 'second@example.com' }]),
    );

    render(<WaitlistSection />);

    expect(await screen.findByText('beta@example.com')).toBeInTheDocument();
    expect(screen.getByText('second@example.com')).toBeInTheDocument();

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/api/admin/waitlist');
    expect(url).toContain('page=1');
  });

  it('shows the empty state when no entries are returned', async () => {
    fetchMock.mockResolvedValueOnce(waitlistResponse([]));
    render(<WaitlistSection />);

    expect(await screen.findByText('No waitlist entries yet.')).toBeInTheDocument();
  });

  it('toggles founding-rider via PATCH and updates the local row state', async () => {
    fetchMock.mockResolvedValueOnce(waitlistResponse([{ isFoundingRider: false }]));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

    render(<WaitlistSection />);

    // The toggle button shows "No" when not a founding rider.
    const toggle = await screen.findByRole('button', { name: 'No' });
    fireEvent.click(toggle);

    await waitFor(() => {
      const lastCall = fetchMock.mock.calls.at(-1);
      expect(lastCall?.[0]).toContain('/api/admin/users/entry-1/founding-rider');
      expect(lastCall?.[1]).toMatchObject({ method: 'PATCH' });
      expect(JSON.parse((lastCall?.[1] as RequestInit).body as string)).toEqual({
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
    fetchMock.mockResolvedValueOnce(waitlistResponse([{ isFoundingRider: false }]));
    window.confirm = vi.fn(() => false);

    render(<WaitlistSection />);

    const toggle = await screen.findByRole('button', { name: 'No' });
    fireEvent.click(toggle);

    expect(window.confirm).toHaveBeenCalledOnce();
    // Only the initial GET should have fired — no PATCH.
    const patches = fetchMock.mock.calls.filter(
      (call) => (call[1] as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patches).toHaveLength(0);
  });

  it('opens a confirm modal for delete and only fires DELETE on confirm', async () => {
    fetchMock.mockResolvedValueOnce(waitlistResponse([{}]));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    render(<WaitlistSection />);

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    // Modal title; scope confirm click to the footer to avoid the still-mounted
    // row Delete button matching the same accessible name.
    expect(await screen.findByText('Remove from waitlist')).toBeInTheDocument();
    const footer = screen.getByTestId('modal-footer');
    fireEvent.click(within(footer).getByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      const lastCall = fetchMock.mock.calls.at(-1);
      expect(lastCall?.[0]).toContain('/api/admin/waitlist/entry-1');
      expect(lastCall?.[1]).toMatchObject({ method: 'DELETE' });
    });
  });

  it('Activate opens a styled confirm modal and POSTs only on confirm', async () => {
    // Activation goes through ConfirmDeleteModal (warning tone) — it
    // provisions a real account + sends a transactional email, so it
    // shouldn't ride on a native window.confirm. Pin the modal flow.
    fetchMock.mockResolvedValueOnce(waitlistResponse([{}]));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

    render(<WaitlistSection />);

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
      const lastCall = fetchMock.mock.calls.at(-1);
      expect(lastCall?.[0]).toContain('/api/admin/activate/entry-1');
      expect(lastCall?.[1]).toMatchObject({ method: 'POST' });
    });

    // The window.confirm is no longer used for activation — it's only
    // used for the founding-rider toggle in this section now.
    expect(window.confirm).not.toHaveBeenCalled();
  });
});
