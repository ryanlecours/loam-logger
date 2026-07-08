import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OverviewSection } from './OverviewSection';
import { AdminStatsProvider } from '../AdminStatsProvider';

const originalFetch = globalThis.fetch;
const fetchMock = vi.fn();

beforeEach(() => {
  globalThis.fetch = fetchMock;
  fetchMock.mockReset();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

// Helper — OverviewSection now consumes the AdminStats context, so every
// test must mount it inside the provider. The provider also fires the
// initial /api/admin/stats fetch on mount, so callers are responsible for
// queueing that first response (or never resolving it, for the loading-state
// test).
function renderInProvider(ui: React.ReactElement) {
  return render(<AdminStatsProvider>{ui}</AdminStatsProvider>);
}

describe('OverviewSection', () => {
  it('renders the two stat cards once /api/admin/stats resolves', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ users: 42, foundingRiders: 3 }),
        { status: 200 },
      ),
    );

    renderInProvider(<OverviewSection />);

    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows skeleton placeholders before stats resolve', () => {
    // Never-resolving fetch — captures the loading state.
    fetchMock.mockImplementationOnce(() => new Promise(() => undefined));

    const { container } = renderInProvider(<OverviewSection />);
    // Two skeleton spans (one per stat card) — distinct from the spinner
    // because we want to keep the card layout stable while loading.
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons).toHaveLength(2);
  });

  it('looks up a user by email and displays the result', async () => {
    // First fetch is the initial stats load — return whatever, we just need
    // it to settle before the lookup fires.
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ users: 0, foundingRiders: 0 }), {
        status: 200,
      }),
    );
    // Second fetch is the lookup itself.
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'abc-123',
          email: 'rider@example.com',
          name: 'Test Rider',
          role: 'PRO',
          createdAt: '2026-01-01T00:00:00.000Z',
          activatedAt: null,
          isFoundingRider: true,
        }),
        { status: 200 },
      ),
    );

    renderInProvider(<OverviewSection />);

    fireEvent.change(screen.getByLabelText('Email Address'), {
      target: { value: 'rider@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lookup' }));

    expect(await screen.findByText('abc-123')).toBeInTheDocument();
    expect(screen.getByText('rider@example.com')).toBeInTheDocument();
    expect(screen.getByText('Test Rider')).toBeInTheDocument();
    expect(screen.getByText('PRO')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument(); // founding rider

    // Assert the second call hit the lookup endpoint with an encoded email.
    const lookupCall = fetchMock.mock.calls[1];
    expect(lookupCall[0]).toContain(
      '/api/admin/lookup-user?email=rider%40example.com',
    );
  });

  it('surfaces a "User not found" error for a 404 lookup', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));

    renderInProvider(<OverviewSection />);

    fireEvent.change(screen.getByLabelText('Email Address'), {
      target: { value: 'ghost@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lookup' }));

    await waitFor(() => {
      expect(screen.getByText('User not found')).toBeInTheDocument();
    });
  });

  it('disables the Lookup button when the email field is empty', () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    renderInProvider(<OverviewSection />);
    expect(screen.getByRole('button', { name: 'Lookup' })).toBeDisabled();
  });
});
