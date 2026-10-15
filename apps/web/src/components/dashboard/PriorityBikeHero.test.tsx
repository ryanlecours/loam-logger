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
vi.mock('./StatusPill', () => ({ StatusPill: () => null }));

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
