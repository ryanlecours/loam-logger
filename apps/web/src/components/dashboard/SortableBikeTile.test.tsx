import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SortableBikeTile } from './SortableBikeTile';
import type { BikeWithPredictions } from '../../hooks/usePriorityBike';
import type { BikePredictionSummary, ComponentPrediction, PredictionStatus } from '../../types/prediction';

// Mock @dnd-kit/sortable
vi.mock('@dnd-kit/sortable', () => ({
  useSortable: vi.fn(() => ({
    attributes: { role: 'button', tabIndex: 0 },
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  })),
}));

// Mock @dnd-kit/utilities
vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: vi.fn(() => null),
    },
  },
}));

// Mock useHoursDisplay to avoid PreferencesProvider dependency
vi.mock('../../hooks/useHoursDisplay', () => ({
  useHoursDisplay: () => ({
    hoursDisplay: 'remaining',
    formatHoursForDisplay: () => '10h remaining',
    formatHoursCompact: () => '10h',
  }),
}));

// Factory for creating test bikes
const createBike = (overrides: Partial<BikeWithPredictions> = {}): BikeWithPredictions => ({
  id: 'bike-1',
  nickname: 'Trail Slayer',
  manufacturer: 'Trek',
  model: 'Slash 9.8',
  thumbnailUrl: null,
  sortOrder: 0,
  predictions: null,
  ...overrides,
});

const createPrediction = (
  overallStatus: PredictionStatus = 'ALL_GOOD',
  hoursRemaining?: number
): BikePredictionSummary => ({
  bikeId: 'bike-1',
  bikeName: 'Test Bike',
  components: [],
  priorityComponent: hoursRemaining !== undefined
    ? { hoursRemaining } as ComponentPrediction
    : null,
  overallStatus,
  dueNowCount: 0,
  dueSoonCount: 0,
  generatedAt: new Date().toISOString(),
});

describe('SortableBikeTile', () => {
  const defaultProps = {
    bike: createBike(),
    isSelected: false,
    onClick: vi.fn(),
    disabled: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders bike name from getBikeName()', () => {
      render(<SortableBikeTile {...defaultProps} />);

      expect(screen.getByText('Trail Slayer')).toBeInTheDocument();
    });

    it('renders bike name as manufacturer + model when no nickname', () => {
      const bike = createBike({ nickname: null });
      render(<SortableBikeTile {...defaultProps} bike={bike} />);

      expect(screen.getByText('Trek Slash 9.8')).toBeInTheDocument();
    });

    it('renders thumbnail when provided', () => {
      const bike = createBike({ thumbnailUrl: 'https://example.com/bike.jpg' });
      render(<SortableBikeTile {...defaultProps} bike={bike} />);

      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', 'https://example.com/bike.jpg');
    });

    it('renders FaBicycle icon when no thumbnail', () => {
      const bike = createBike({ thumbnailUrl: null });
      render(<SortableBikeTile {...defaultProps} bike={bike} />);

      // FaBicycle renders as an SVG
      const button = screen.getByRole('button');
      expect(button.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('status mapping', () => {
    it('applies status-dot-overdue class for OVERDUE', () => {
      const bike = createBike({
        predictions: createPrediction('OVERDUE', -5),
      });
      render(<SortableBikeTile {...defaultProps} bike={bike} />);

      const statusDot = document.querySelector('.bike-tile-status');
      expect(statusDot).toHaveClass('status-dot-overdue');
    });

    it('applies status-dot-due-now class for DUE_NOW', () => {
      const bike = createBike({
        predictions: createPrediction('DUE_NOW', 5),
      });
      render(<SortableBikeTile {...defaultProps} bike={bike} />);

      const statusDot = document.querySelector('.bike-tile-status');
      expect(statusDot).toHaveClass('status-dot-due-now');
    });

    it('applies status-dot-due-soon class for DUE_SOON', () => {
      const bike = createBike({
        predictions: createPrediction('DUE_SOON', 15),
      });
      render(<SortableBikeTile {...defaultProps} bike={bike} />);

      const statusDot = document.querySelector('.bike-tile-status');
      expect(statusDot).toHaveClass('status-dot-due-soon');
    });

    it('applies status-dot-all-good class for ALL_GOOD', () => {
      const bike = createBike({
        predictions: createPrediction('ALL_GOOD'),
      });
      render(<SortableBikeTile {...defaultProps} bike={bike} />);

      const statusDot = document.querySelector('.bike-tile-status');
      expect(statusDot).toHaveClass('status-dot-all-good');
    });

    it('defaults to ALL_GOOD when no predictions', () => {
      const bike = createBike({ predictions: null });
      render(<SortableBikeTile {...defaultProps} bike={bike} />);

      const statusDot = document.querySelector('.bike-tile-status');
      expect(statusDot).toHaveClass('status-dot-all-good');
    });
  });

  describe('hours remaining display', () => {
    it('shows hours remaining when status is not ALL_GOOD', () => {
      const bike = createBike({
        predictions: createPrediction('DUE_SOON', 12.5),
      });
      render(<SortableBikeTile {...defaultProps} bike={bike} />);

      expect(screen.getByText('12.5 hrs')).toBeInTheDocument();
    });

    it('hides hours remaining when status is ALL_GOOD', () => {
      const bike = createBike({
        predictions: createPrediction('ALL_GOOD', 100),
      });
      render(<SortableBikeTile {...defaultProps} bike={bike} />);

      expect(screen.queryByText(/hrs$/)).not.toBeInTheDocument();
    });

    it('formats hours to 1 decimal place', () => {
      const bike = createBike({
        predictions: createPrediction('DUE_NOW', 5.789),
      });
      render(<SortableBikeTile {...defaultProps} bike={bike} />);

      expect(screen.getByText('5.8 hrs')).toBeInTheDocument();
    });

    it('hides hours when priorityComponent is null', () => {
      const bike = createBike({
        predictions: {
          ...createPrediction('DUE_SOON'),
          priorityComponent: null,
        },
      });
      render(<SortableBikeTile {...defaultProps} bike={bike} />);

      expect(screen.queryByText(/hrs$/)).not.toBeInTheDocument();
    });
  });

  describe('selection and click', () => {
    it('applies bike-tile-selected class when isSelected', () => {
      render(<SortableBikeTile {...defaultProps} isSelected={true} />);

      const button = screen.getByRole('button');
      expect(button).toHaveClass('bike-tile-selected');
    });

    it('does not apply bike-tile-selected class when not selected', () => {
      render(<SortableBikeTile {...defaultProps} isSelected={false} />);

      const button = screen.getByRole('button');
      expect(button).not.toHaveClass('bike-tile-selected');
    });

    it('calls onClick when clicked', () => {
      const onClick = vi.fn();
      render(<SortableBikeTile {...defaultProps} onClick={onClick} />);

      fireEvent.click(screen.getByRole('button'));

      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('disabled state', () => {
    it('applies opacity 0.5 when disabled', () => {
      render(<SortableBikeTile {...defaultProps} disabled={true} />);

      const button = screen.getByRole('button');
      expect(button).toHaveStyle({ opacity: '0.5' });
    });

    it('applies cursor wait when disabled', () => {
      render(<SortableBikeTile {...defaultProps} disabled={true} />);

      const button = screen.getByRole('button');
      expect(button).toHaveStyle({ cursor: 'wait' });
    });

    it('applies cursor grab when not disabled', () => {
      render(<SortableBikeTile {...defaultProps} disabled={false} />);

      const button = screen.getByRole('button');
      expect(button).toHaveStyle({ cursor: 'grab' });
    });
  });

  describe('title attribute', () => {
    it('includes bike name and drag hint in title', () => {
      render(<SortableBikeTile {...defaultProps} />);

      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('title', 'Trail Slayer (drag to reorder)');
    });
  });
});
