import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LiftTag from './LiftTag';
import type { RideLiftSummary } from '../lib/rideLift';

const lift = (overrides: Partial<RideLiftSummary> = {}): RideLiftSummary => ({
  elevationGainMeters: 2276,
  countElevation: false,
  countElevationChoice: null,
  segments: [
    { liftName: 'Fitzsimmons Express', kind: 'CHAIRLIFT' },
    { liftName: 'Garbanzo Express', kind: 'CHAIRLIFT' },
  ],
  ...overrides,
});

describe('LiftTag', () => {
  it('names a chairlift day', () => {
    render(<LiftTag lift={lift()} />);
    expect(screen.getByText('Chairlift detected')).toBeInTheDocument();
  });

  it('names a gondola, and falls back to "Lift" for surface or unknown lifts', () => {
    const { rerender } = render(<LiftTag lift={lift({ segments: [{ kind: 'GONDOLA' }] })} />);
    expect(screen.getByText('Gondola detected')).toBeInTheDocument();

    rerender(<LiftTag lift={lift({ segments: [{ liftName: 'T-Bar', kind: 'OTHER' }] })} />);
    expect(screen.getByText('Lift detected')).toBeInTheDocument();

    rerender(<LiftTag lift={lift({ segments: [{ liftName: 'Old Chair', kind: null }] })} />);
    expect(screen.getByText('Lift detected')).toBeInTheDocument();
  });

  it('says whether the lift climb counts, for hover and screen readers', () => {
    const { rerender } = render(<LiftTag lift={lift()} />);
    expect(screen.getByText('Chairlift detected').closest('.badge')).toHaveAttribute(
      'title',
      'Chairlift detected. Lift climb not counted.'
    );

    rerender(<LiftTag lift={lift({ countElevation: true, countElevationChoice: true })} />);
    expect(screen.getByLabelText('Chairlift detected. Lift climb counted.')).toBeInTheDocument();
  });
});
