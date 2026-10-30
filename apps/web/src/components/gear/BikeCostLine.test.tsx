import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BikeCostLine } from './BikeCostLine';

const mockUseQuery = vi.fn();
vi.mock('@apollo/client', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  gql: vi.fn((strings: TemplateStringsArray) => strings[0]),
}));

const mockIsPro = vi.fn(() => true);
vi.mock('@/hooks/useUserTier', () => ({
  useUserTier: () => ({ isPro: mockIsPro(), tier: mockIsPro() ? 'PRO' : 'FREE' }),
}));

vi.mock('@/components/UpgradePrompt', () => ({
  ProChip: ({ source }: { source: string }) => <span data-testid="pro-chip">{source}</span>,
}));

const capture = vi.fn();
vi.mock('@/lib/posthog', () => ({ posthog: { capture: (...args: unknown[]) => capture(...args) } }));

const summary = {
  currency: 'USD',
  bikeMinor: 450000,
  partsMinor: 60000,
  serviceMinor: 14000,
  totalMinor: 524000,
  rideHours: 250,
  perHourMinor: 2096,
  otherCurrencyCount: 0,
  byYear: [
    { year: 2026, partsMinor: 20000, serviceMinor: 8000 },
    { year: 2025, partsMinor: 40000, serviceMinor: 6000 },
  ],
};

describe('BikeCostLine', () => {
  beforeEach(() => {
    capture.mockClear();
    mockUseQuery.mockReset();
  });

  it('shows the quiet Pro chip to Free riders and skips the query', () => {
    mockIsPro.mockReturnValue(false);
    mockUseQuery.mockReturnValue({ data: undefined });

    render(<BikeCostLine bikeId="bike-1" />);

    expect(screen.getByText('What does this bike cost to ride?')).toBeInTheDocument();
    expect(screen.getByTestId('pro-chip')).toHaveTextContent('bike-cost-per-hour');
    expect(mockUseQuery.mock.calls[0][1]).toMatchObject({ skip: true });
    expect(capture).toHaveBeenCalledWith('cost_insight_viewed', { surface: 'bike', tier: 'FREE' });
  });

  it('reads the total, the per-hour figure and the first year for Pro', () => {
    mockIsPro.mockReturnValue(true);
    mockUseQuery.mockReturnValue({ data: { bike: { id: 'bike-1', costSummary: summary } } });

    render(<BikeCostLine bikeId="bike-1" />);

    const line = screen.getByText(/Spent/);
    expect(line).toHaveTextContent('Spent $5,240.00');
    expect(line).toHaveTextContent('$20.96 per ride hour');
    expect(line).toHaveTextContent('since 2025');
    expect(screen.queryByTestId('pro-chip')).not.toBeInTheDocument();
    expect(capture).toHaveBeenCalledWith('cost_insight_viewed', { surface: 'bike', tier: 'PRO' });
  });

  it('says plainly when nothing has been recorded', () => {
    mockIsPro.mockReturnValue(true);
    mockUseQuery.mockReturnValue({
      data: { bike: { id: 'bike-1', costSummary: { ...summary, bikeMinor: null, partsMinor: 0, serviceMinor: 0, totalMinor: 0, perHourMinor: null, byYear: [] } } },
    });

    render(<BikeCostLine bikeId="bike-1" />);

    expect(screen.getByText(/Nothing spent on record yet/)).toBeInTheDocument();
  });
});
