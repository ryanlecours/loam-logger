import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BikeSwitcherTile } from './BikeSwitcherTile';
import type { BikeWithPredictions } from '../../hooks/usePriorityBike';
import type { AdvisorSummary, BikePredictionSummary } from '../../types/prediction';

// Avoids the PreferencesProvider dependency (see ComponentHealthPanel.test).
vi.mock('../../hooks/useHoursDisplay', () => ({
  useHoursDisplay: () => ({ hoursDisplay: 'remaining' }),
}));

const advisor: AdvisorSummary = {
  text: 'Rear brake pads are due — plan a swap before your next few rides.',
  generatedAt: '2026-07-16T00:00:00.000Z',
  modelVersion: 'claude-haiku-4-5-20251001',
};

const predictions = (
  overrides: Partial<BikePredictionSummary> = {}
): BikePredictionSummary => ({
  bikeId: 'bike-1',
  bikeName: 'Slash',
  components: [],
  priorityComponent: null,
  overallStatus: 'DUE_SOON',
  dueNowCount: 0,
  dueSoonCount: 1,
  generatedAt: '2026-07-16T00:00:00.000Z',
  ...overrides,
});

const bike = (predictionsValue: BikePredictionSummary | null): BikeWithPredictions => ({
  id: 'bike-1',
  nickname: 'Trailhog',
  manufacturer: 'Trek',
  model: 'Slash',
  sortOrder: 0,
  predictions: predictionsValue,
});

const renderTile = (b: BikeWithPredictions) =>
  render(<BikeSwitcherTile bike={b} isSelected={false} onClick={() => {}} />);

describe('BikeSwitcherTile advisor hint', () => {
  it('renders the summary text with a full-text tooltip when present', () => {
    renderTile(bike(predictions({ advisorSummary: advisor })));

    const hint = screen.getByText(advisor.text);
    expect(hint).toBeInTheDocument();
    expect(hint).toHaveAttribute('title', advisor.text);
  });

  it('renders no hint when advisorSummary is null', () => {
    renderTile(bike(predictions({ advisorSummary: null })));
    expect(screen.queryByText(advisor.text)).not.toBeInTheDocument();
  });

  it('renders no hint when advisorSummary is absent (advisor stage not resolved)', () => {
    renderTile(bike(predictions()));
    expect(screen.queryByText(advisor.text)).not.toBeInTheDocument();
  });

  it('renders no hint when the bike has no predictions', () => {
    renderTile(bike(null));
    expect(screen.queryByText(advisor.text)).not.toBeInTheDocument();
  });
});
