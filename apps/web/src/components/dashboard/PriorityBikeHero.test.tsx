import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { PriorityBikeHero } from './PriorityBikeHero';
import type { BikeWithPredictions } from '../../hooks/usePriorityBike';

// The hero's data hooks and heavier children are out of scope here; these
// tests cover its actions.
vi.mock('../../hooks/useBikeRides', () => ({
  useBikeRides: () => ({
    rides: [],
    canGoNewer: false,
    canGoOlder: false,
    goNewer: vi.fn(),
    goOlder: vi.fn(),
    loading: false,
    pageIndex: 0,
    rangeInfo: null,
  }),
}));
vi.mock('../../hooks/useUserTier', () => ({ useUserTier: () => ({ isFree: false }) }));
vi.mock('./ComponentHealthPanel', () => ({ ComponentHealthPanel: () => null }));
vi.mock('./AdvisorSummaryCard', () => ({ AdvisorSummaryCard: () => null }));
vi.mock('./StatusPill', () => ({
  StatusPill: ({ status }: { status: string | null }) => (
    <span data-testid="status-pill">{status}</span>
  ),
  NoRidesPill: () => <span data-testid="no-rides-pill">No rides yet</span>,
}));

const bike = {
  id: 'bike-1',
  nickname: 'Trail bike',
  predictions: null,
} as unknown as BikeWithPredictions;

function renderHero() {
  return render(
    <MemoryRouter>
      <PriorityBikeHero
        bike={bike}
        isShowingPriority
        onResetToPriority={vi.fn()}
        onLogService={vi.fn()}
      />
    </MemoryRouter>
  );
}

describe('PriorityBikeHero actions', () => {
  it("links View maintenance to the bike's service log", () => {
    renderHero();
    expect(screen.getByRole('link', { name: /View maintenance/ })).toHaveAttribute(
      'href',
      '/gear/bike-1/history?show=service'
    );
  });
});

describe('PriorityBikeHero rides column', () => {
  // The old empty state offered "Connect Strava" to every rider with a bike
  // and no rides, including riders who had connected something else.
  it('no longer offers a Strava-only connect button', () => {
    renderHero();
    expect(screen.getByText('No rides on this bike yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Strava/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log a ride' })).toHaveAttribute('href', '/rides');
  });

  it('shows the ride source card in place of the empty list when given one', () => {
    render(
      <MemoryRouter>
        <PriorityBikeHero
          bike={bike}
          isShowingPriority
          onResetToPriority={vi.fn()}
          onLogService={vi.fn()}
          rideSourceCard={<div data-testid="ride-source-card">No ride source connected</div>}
        />
      </MemoryRouter>
    );
    expect(screen.getByTestId('ride-source-card')).toBeInTheDocument();
    expect(screen.queryByText('No rides on this bike yet')).not.toBeInTheDocument();
  });
});

describe('PriorityBikeHero header pill', () => {
  it('wears the health pill once the account has rides', () => {
    renderHero();
    expect(screen.getByTestId('status-pill')).toHaveTextContent('ALL_GOOD');
    expect(screen.queryByTestId('no-rides-pill')).not.toBeInTheDocument();
  });

  // A bike with no hours ridden has no health state. The previous header
  // said All Good to a rider whose import had not landed yet.
  it('wears the neutral badge instead of All Good while the account has no rides', () => {
    render(
      <MemoryRouter>
        <PriorityBikeHero
          bike={bike}
          isShowingPriority
          onResetToPriority={vi.fn()}
          onLogService={vi.fn()}
          rideSourceCard={<div data-testid="ride-source-card">Importing</div>}
        />
      </MemoryRouter>
    );
    expect(screen.getByTestId('no-rides-pill')).toHaveTextContent('No rides yet');
    expect(screen.queryByTestId('status-pill')).not.toBeInTheDocument();
  });
});
