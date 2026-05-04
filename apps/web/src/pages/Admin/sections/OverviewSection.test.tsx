import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OverviewSection } from './OverviewSection';

const originalFetch = globalThis.fetch;
const fetchMock = vi.fn();

beforeEach(() => {
  globalThis.fetch = fetchMock;
  fetchMock.mockReset();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('OverviewSection', () => {
  it('renders the three stat cards once /api/admin/stats resolves', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ users: 42, waitlist: 7, foundingRiders: 3 }),
        { status: 200 },
      ),
    );

    render(<OverviewSection />);

    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('shows skeleton placeholders before stats resolve', () => {
    // Never-resolving fetch — captures the loading state.
    fetchMock.mockImplementationOnce(() => new Promise(() => undefined));

    const { container } = render(<OverviewSection />);
    // Three skeleton spans (one per stat card) — distinct from the spinner
    // because we want to keep the card layout stable while loading.
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons).toHaveLength(3);
  });

  it('looks up a user by email and displays the result', async () => {
    // First fetch is the initial stats load — return whatever, we just need
    // it to settle before the lookup fires.
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ users: 0, waitlist: 0, foundingRiders: 0 }), {
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

    render(<OverviewSection />);

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

    render(<OverviewSection />);

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
    render(<OverviewSection />);
    expect(screen.getByRole('button', { name: 'Lookup' })).toBeDisabled();
  });
});
