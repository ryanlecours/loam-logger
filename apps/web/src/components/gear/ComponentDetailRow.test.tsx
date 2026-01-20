import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComponentDetailRow } from './ComponentDetailRow';

// Mock framer-motion to avoid animation issues in tests
vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<React.HTMLAttributes<HTMLDivElement>>) => (
      <div {...props}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren<object>) => <>{children}</>,
}));

// Mock StatusDot
vi.mock('../dashboard/StatusDot', () => ({
  StatusDot: ({ status }: { status: string }) => (
    <span data-testid={`status-dot-${status}`} />
  ),
}));

// Mock formatComponentLabel
vi.mock('../../utils/formatters', () => ({
  formatComponentLabel: (comp: { componentType: string; location?: string | null }) =>
    comp.location ? `${comp.componentType} (${comp.location})` : comp.componentType,
}));

// Mock useHoursDisplay to avoid PreferencesProvider dependency
vi.mock('../../hooks/useHoursDisplay', () => ({
  useHoursDisplay: () => ({
    hoursDisplay: 'remaining',
    formatHoursForDisplay: () => '4.5h remaining',
    formatHoursCompact: () => '4.5h',
  }),
}));

describe('ComponentDetailRow', () => {
  const createComponent = (overrides = {}) => ({
    id: 'comp-1',
    type: 'FORK',
    brand: 'RockShox',
    model: 'Pike Ultimate',
    isStock: false,
    notes: null,
    hoursUsed: 45.5,
    serviceDueAtHours: 50,
    ...overrides,
  });

  const createPrediction = (overrides = {}) => ({
    componentId: 'comp-1',
    componentType: 'FORK',
    location: null,
    brand: 'RockShox',
    model: 'Pike Ultimate',
    status: 'DUE_SOON' as const,
    hoursRemaining: 4.5,
    ridesRemainingEstimate: 3,
    confidence: 'HIGH',
    currentHours: 45.5,
    serviceIntervalHours: 50,
    hoursSinceService: 45.5,
    ...overrides,
  });

  const defaultProps = {
    component: createComponent(),
    prediction: createPrediction(),
    onEdit: vi.fn(),
  };

  describe('rendering', () => {
    it('renders brand/model as component label when available', () => {
      render(<ComponentDetailRow {...defaultProps} />);

      // Component name shows brand/model when available
      const nameElement = document.querySelector('.component-detail-name');
      expect(nameElement).toHaveTextContent('RockShox Pike Ultimate');
    });

    it('renders component type', () => {
      render(<ComponentDetailRow {...defaultProps} />);

      // Component type appears in span.component-detail-type
      const typeElement = document.querySelector('.component-detail-type');
      expect(typeElement).toHaveTextContent('FORK');
    });

    it('renders location when present', () => {
      render(
        <ComponentDetailRow
          {...defaultProps}
          prediction={createPrediction({ location: 'FRONT' })}
        />
      );

      const typeElement = document.querySelector('.component-detail-type');
      expect(typeElement).toHaveTextContent('FRONT');
    });

    it('renders status dot with correct status', () => {
      render(<ComponentDetailRow {...defaultProps} />);

      expect(screen.getByTestId('status-dot-DUE_SOON')).toBeInTheDocument();
    });

    it('defaults to ALL_GOOD status when no prediction', () => {
      render(<ComponentDetailRow {...defaultProps} prediction={null} />);

      expect(screen.getByTestId('status-dot-ALL_GOOD')).toBeInTheDocument();
    });

    it('renders hours remaining when present', () => {
      render(<ComponentDetailRow {...defaultProps} />);

      expect(screen.getByText('4.5h')).toBeInTheDocument();
      expect(screen.getByText('left')).toBeInTheDocument();
    });

    it('does not render hours when null', () => {
      render(
        <ComponentDetailRow
          {...defaultProps}
          prediction={createPrediction({ hoursRemaining: null as unknown as number })}
        />
      );

      expect(screen.queryByText('left')).not.toBeInTheDocument();
    });

    it('renders edit button', () => {
      render(<ComponentDetailRow {...defaultProps} />);

      // Edit button aria-label uses the componentLabel (brand/model when available)
      expect(screen.getByRole('button', { name: /Edit RockShox Pike Ultimate/i })).toBeInTheDocument();
    });
  });

  describe('expand/collapse', () => {
    it('is collapsed by default', () => {
      render(<ComponentDetailRow {...defaultProps} />);

      expect(screen.queryByText('Brand')).not.toBeInTheDocument();
    });

    it('expands on summary click', () => {
      render(<ComponentDetailRow {...defaultProps} />);

      const summary = document.querySelector('.component-detail-summary') as HTMLElement;
      fireEvent.click(summary);

      expect(screen.getByText('Brand')).toBeInTheDocument();
      expect(screen.getByText('RockShox')).toBeInTheDocument();
    });

    it('collapses on second click', () => {
      render(<ComponentDetailRow {...defaultProps} />);

      const summary = document.querySelector('.component-detail-summary') as HTMLElement;
      fireEvent.click(summary);
      expect(screen.getByText('Brand')).toBeInTheDocument();

      fireEvent.click(summary);
      expect(screen.queryByText('Brand')).not.toBeInTheDocument();
    });

    it('expands on Enter key', () => {
      render(<ComponentDetailRow {...defaultProps} />);

      const summary = document.querySelector('.component-detail-summary') as HTMLElement;
      fireEvent.keyDown(summary, { key: 'Enter' });

      expect(screen.getByText('Brand')).toBeInTheDocument();
    });

    it('expands on Space key', () => {
      render(<ComponentDetailRow {...defaultProps} />);

      const summary = document.querySelector('.component-detail-summary') as HTMLElement;
      fireEvent.keyDown(summary, { key: ' ' });

      expect(screen.getByText('Brand')).toBeInTheDocument();
    });

    it('has correct aria-expanded attribute', () => {
      render(<ComponentDetailRow {...defaultProps} />);

      const summary = document.querySelector('.component-detail-summary') as HTMLElement;
      expect(summary).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(summary);
      expect(summary).toHaveAttribute('aria-expanded', 'true');
    });

    it('applies expanded class when expanded', () => {
      render(<ComponentDetailRow {...defaultProps} />);

      const summary = document.querySelector('.component-detail-summary') as HTMLElement;
      fireEvent.click(summary);

      const row = document.querySelector('.component-detail-row');
      expect(row).toHaveClass('component-detail-row-expanded');
    });
  });

  describe('expanded details', () => {
    beforeEach(() => {
      render(<ComponentDetailRow {...defaultProps} />);
      const summary = document.querySelector('.component-detail-summary') as HTMLElement;
      fireEvent.click(summary);
    });

    it('shows brand', () => {
      expect(screen.getByText('Brand')).toBeInTheDocument();
      expect(screen.getByText('RockShox')).toBeInTheDocument();
    });

    it('shows model', () => {
      expect(screen.getByText('Model')).toBeInTheDocument();
      expect(screen.getByText('Pike Ultimate')).toBeInTheDocument();
    });

    it('shows current hours from prediction', () => {
      expect(screen.getByText('Current Hours')).toBeInTheDocument();
      // 45.5h appears twice (Current Hours and Hours Since Service)
      expect(screen.getAllByText('45.5h').length).toBeGreaterThanOrEqual(1);
    });

    it('shows service interval', () => {
      expect(screen.getByText('Service Interval')).toBeInTheDocument();
      expect(screen.getByText('50.0h')).toBeInTheDocument();
    });

    it('shows hours since service when present', () => {
      expect(screen.getByText('Hours Since Service')).toBeInTheDocument();
      expect(screen.getAllByText('45.5h')).toHaveLength(2); // Current hours and hours since service
    });

    it('shows stock/aftermarket type', () => {
      expect(screen.getByText('Type')).toBeInTheDocument();
      expect(screen.getByText('Aftermarket')).toBeInTheDocument();
    });
  });

  describe('optional fields', () => {
    it('shows confidence when present', () => {
      render(<ComponentDetailRow {...defaultProps} />);
      const summary = document.querySelector('.component-detail-summary') as HTMLElement;
      fireEvent.click(summary);

      expect(screen.getByText('Confidence')).toBeInTheDocument();
      expect(screen.getByText('high')).toBeInTheDocument();
    });

    it('shows rides remaining when present', () => {
      render(<ComponentDetailRow {...defaultProps} />);
      const summary = document.querySelector('.component-detail-summary') as HTMLElement;
      fireEvent.click(summary);

      expect(screen.getByText('Rides Remaining')).toBeInTheDocument();
      expect(screen.getByText('~3 rides')).toBeInTheDocument();
    });

    it('shows notes when present', () => {
      render(
        <ComponentDetailRow
          {...defaultProps}
          component={createComponent({ notes: 'Needs rebuild soon' })}
        />
      );
      const summary = document.querySelector('.component-detail-summary') as HTMLElement;
      fireEvent.click(summary);

      expect(screen.getByText('Notes')).toBeInTheDocument();
      expect(screen.getByText('Needs rebuild soon')).toBeInTheDocument();
    });

    it('shows baseline wear when present', () => {
      render(
        <ComponentDetailRow
          {...defaultProps}
          component={createComponent({
            baselineWearPercent: 25,
            baselineMethod: 'manual',
          })}
        />
      );
      const summary = document.querySelector('.component-detail-summary') as HTMLElement;
      fireEvent.click(summary);

      expect(screen.getByText('Baseline Wear')).toBeInTheDocument();
      expect(screen.getByText(/25%/)).toBeInTheDocument();
      expect(screen.getByText(/Manual/)).toBeInTheDocument();
    });

    it('shows last serviced date when present', () => {
      render(
        <ComponentDetailRow
          {...defaultProps}
          component={createComponent({ lastServicedAt: '2024-01-15T10:00:00Z' })}
        />
      );
      const summary = document.querySelector('.component-detail-summary') as HTMLElement;
      fireEvent.click(summary);

      expect(screen.getByText('Last Serviced')).toBeInTheDocument();
      expect(screen.getByText('Jan 15, 2024')).toBeInTheDocument();
    });
  });

  describe('edit button', () => {
    it('calls onEdit when clicked', () => {
      const onEdit = vi.fn();
      render(<ComponentDetailRow {...defaultProps} onEdit={onEdit} />);

      fireEvent.click(screen.getByRole('button', { name: /Edit RockShox Pike Ultimate/i }));

      expect(onEdit).toHaveBeenCalledTimes(1);
    });

    it('does not expand/collapse when edit clicked', () => {
      const onEdit = vi.fn();
      render(<ComponentDetailRow {...defaultProps} onEdit={onEdit} />);

      fireEvent.click(screen.getByRole('button', { name: /Edit RockShox Pike Ultimate/i }));

      expect(screen.queryByText('Brand')).not.toBeInTheDocument();
    });
  });

  describe('fallback behavior', () => {
    it('uses component brand/model when no prediction', () => {
      render(
        <ComponentDetailRow
          {...defaultProps}
          prediction={null}
          component={createComponent({ brand: 'Fox', model: 'Float 36' })}
        />
      );

      expect(screen.getByText('Fox Float 36')).toBeInTheDocument();
    });

    it('uses component type when no brand/model', () => {
      render(
        <ComponentDetailRow
          {...defaultProps}
          prediction={null}
          component={createComponent({ brand: '', model: '' })}
        />
      );

      // FORK appears in both name and type elements
      const nameElement = document.querySelector('.component-detail-name');
      expect(nameElement).toHaveTextContent('FORK');
    });

    it('uses component hoursUsed when no prediction currentHours', () => {
      render(
        <ComponentDetailRow
          {...defaultProps}
          prediction={createPrediction({ currentHours: null })}
          component={createComponent({ hoursUsed: 30 })}
        />
      );
      const summary = document.querySelector('.component-detail-summary') as HTMLElement;
      fireEvent.click(summary);

      expect(screen.getByText('30.0h')).toBeInTheDocument();
    });
  });

  describe('formatting', () => {
    it('formats hours with one decimal place', () => {
      render(
        <ComponentDetailRow
          {...defaultProps}
          prediction={createPrediction({ hoursRemaining: 10.333 })}
        />
      );

      expect(screen.getByText('10.3h')).toBeInTheDocument();
    });

    it('shows dash for null hours', () => {
      render(
        <ComponentDetailRow
          {...defaultProps}
          component={createComponent({ hoursUsed: null })}
          prediction={createPrediction({ currentHours: null })}
        />
      );
      const summary = document.querySelector('.component-detail-summary') as HTMLElement;
      fireEvent.click(summary);

      const dashElements = screen.getAllByText('—');
      expect(dashElements.length).toBeGreaterThan(0);
    });

    it('formats baseline method labels correctly', () => {
      const methods = [
        { method: 'manual', expected: 'Manual' },
        { method: 'inferred', expected: 'Inferred from rides' },
        { method: 'default', expected: 'Default' },
      ];

      methods.forEach(({ method, expected }) => {
        const { unmount } = render(
          <ComponentDetailRow
            {...defaultProps}
            component={createComponent({
              baselineWearPercent: 10,
              baselineMethod: method,
            })}
          />
        );
        const summary = document.querySelector('.component-detail-summary') as HTMLElement;
      fireEvent.click(summary);

        expect(screen.getByText(new RegExp(expected))).toBeInTheDocument();
        unmount();
      });
    });
  });
});
