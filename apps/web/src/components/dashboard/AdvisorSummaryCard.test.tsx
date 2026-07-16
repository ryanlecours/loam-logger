import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdvisorSummaryCard } from './AdvisorSummaryCard';
import type { AdvisorSummary } from '../../types/prediction';

const summary: AdvisorSummary = {
  text: 'Your rear brake pads are due — plan a swap before your next few rides.',
  generatedAt: '2026-07-15T00:00:00.000Z',
  modelVersion: 'claude-haiku-4-5-20251001',
};

describe('AdvisorSummaryCard', () => {
  it('renders the summary text when a summary is present', () => {
    render(<AdvisorSummaryCard summary={summary} />);
    expect(screen.getByText(summary.text)).toBeInTheDocument();
    expect(screen.getByText('AI summary')).toBeInTheDocument();
  });

  it('renders nothing when summary is null', () => {
    const { container } = render(<AdvisorSummaryCard summary={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('exposes an accessible label for the summary region', () => {
    render(<AdvisorSummaryCard summary={summary} />);
    expect(
      screen.getByRole('complementary', { name: /AI maintenance summary/i })
    ).toBeInTheDocument();
  });
});
