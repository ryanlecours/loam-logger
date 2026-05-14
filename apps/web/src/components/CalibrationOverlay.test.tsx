import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CalibrationOverlay } from './CalibrationOverlay';
import type { BikeCalibrationInfo } from '../graphql/calibration';
import type { ComponentPrediction } from '../types/prediction';

// Mock the GraphQL hooks
const mockLogBulkService = vi.fn();
const mockDismissCalibration = vi.fn();
const mockCompleteCalibration = vi.fn();
const mockSnoozeComponent = vi.fn();
const mockRefetch = vi.fn();

// Store mock data that can be changed per test
let mockCalibrationData: {
  calibrationState: {
    showOverlay: boolean;
    overdueCount: number;
    totalComponentCount: number;
    bikes: BikeCalibrationInfo[];
  };
} | null = null;

vi.mock('../graphql/calibration', () => ({
  useCalibrationState: vi.fn(() => ({
    data: mockCalibrationData,
    refetch: mockRefetch,
  })),
  useLogBulkService: vi.fn(() => [mockLogBulkService]),
  useDismissCalibration: vi.fn(() => [mockDismissCalibration]),
  useCompleteCalibration: vi.fn(() => [mockCompleteCalibration]),
  useSnoozeComponent: vi.fn(() => [mockSnoozeComponent]),
}));

// Mock the Modal component to avoid portal issues
vi.mock('./ui/Modal', () => ({
  Modal: ({
    isOpen,
    onClose,
    title,
    subtitle,
    children,
  }: {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    subtitle?: string;
    children: React.ReactNode;
  }) =>
    isOpen ? (
      <div data-testid="modal">
        <h2>{title}</h2>
        {subtitle && <p data-testid="subtitle">{subtitle}</p>}
        <button onClick={onClose} data-testid="modal-close">
          Close
        </button>
        {children}
      </div>
    ) : null,
}));

// Mock Button component
vi.mock('./ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    variant,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: string;
  }) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant}>
      {children}
    </button>
  ),
}));

// Mock StatusDot component
vi.mock('./dashboard/StatusDot', () => ({
  StatusDot: ({ status }: { status: string }) => (
    <span data-testid={`status-dot-${status}`} />
  ),
}));

// Mock react-icons
vi.mock('react-icons/fa', () => ({
  FaBellSlash: () => <span data-testid="icon-bell-slash" />,
  FaBicycle: () => <span data-testid="icon-bicycle" />,
  FaCheck: () => <span data-testid="icon-check" />,
  FaChevronDown: () => <span data-testid="icon-chevron-down" />,
  FaChevronUp: () => <span data-testid="icon-chevron-up" />,
  FaExclamationTriangle: () => <span data-testid="icon-exclamation" />,
  FaCheckCircle: () => <span data-testid="icon-check-circle" />,
}));

// Mock formatters
vi.mock('../utils/formatters', () => ({
  formatComponentLabel: (c: ComponentPrediction) => `${c.componentType}${c.location !== 'NONE' ? ` (${c.location})` : ''}`,
}));

// Factory for creating test components
const createComponent = (
  id: string,
  overrides: Partial<ComponentPrediction> = {}
): ComponentPrediction => ({
  componentId: id,
  componentType: 'FORK',
  location: 'NONE',
  brand: 'RockShox',
  model: 'Pike',
  status: 'OVERDUE',
  hoursRemaining: -10,
  ridesRemainingEstimate: 0,
  confidence: 'HIGH',
  currentHours: 60,
  serviceIntervalHours: 50,
  hoursSinceService: 60,
  why: null,
  drivers: null,
  ...overrides,
});

// Factory for creating test bikes
const createBike = (
  id: string,
  name: string,
  components: ComponentPrediction[]
): BikeCalibrationInfo => ({
  bikeId: id,
  bikeName: name,
  thumbnailUrl: null,
  components,
});

// Helper to set up calibration state
const setupCalibrationState = (
  bikes: BikeCalibrationInfo[],
  showOverlay = true
) => {
  const totalComponents = bikes.reduce((sum, b) => sum + b.components.length, 0);
  mockCalibrationData = {
    calibrationState: {
      showOverlay,
      overdueCount: totalComponents,
      totalComponentCount: totalComponents,
      bikes,
    },
  };
};

describe('CalibrationOverlay', () => {
  const defaultOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogBulkService.mockReset();
    mockDismissCalibration.mockReset();
    mockCompleteCalibration.mockReset();
    mockSnoozeComponent.mockReset();
    mockRefetch.mockReset();
    mockCalibrationData = null;
    mockLogBulkService.mockResolvedValue({
      data: { logBulkComponentService: { success: true, updatedCount: 1 } },
    });
    mockDismissCalibration.mockResolvedValue({
      data: { dismissCalibration: { id: 'user-1' } },
    });
    mockCompleteCalibration.mockResolvedValue({
      data: { completeCalibration: { id: 'user-1' } },
    });
    mockSnoozeComponent.mockResolvedValue({
      data: { snoozeComponent: { id: 'comp-1', serviceDueAtHours: 100 } },
    });
  });

  describe('rendering', () => {
    it('returns null when no calibration data and showOverlay is false', () => {
      mockCalibrationData = {
        calibrationState: {
          showOverlay: false,
          overdueCount: 0,
          totalComponentCount: 0,
          bikes: [],
        },
      };

      const { container } = render(
        <CalibrationOverlay isOpen={true} onClose={defaultOnClose} />
      );

      expect(container.firstChild).toBeNull();
    });

    it('renders modal with correct title when open', () => {
      const bike = createBike('bike-1', 'Trail Bike', [createComponent('comp-1')]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      expect(screen.getByText('Calibrate Your Components')).toBeInTheDocument();
    });

    it('shows correct remaining count in subtitle', () => {
      const bike = createBike('bike-1', 'Trail Bike', [
        createComponent('comp-1'),
        createComponent('comp-2'),
      ]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      expect(screen.getByTestId('subtitle')).toHaveTextContent(
        '2 components need attention'
      );
    });

    it('shows singular form for single component', () => {
      const bike = createBike('bike-1', 'Trail Bike', [createComponent('comp-1')]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      expect(screen.getByTestId('subtitle')).toHaveTextContent(
        '1 component needs attention'
      );
    });

    it('renders progress bar with correct initial state', () => {
      const bike = createBike('bike-1', 'Trail Bike', [
        createComponent('comp-1'),
        createComponent('comp-2'),
      ]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      expect(screen.getByText('0 of 2 calibrated')).toBeInTheDocument();
    });

    it('renders bike section with name', () => {
      const bike = createBike('bike-1', 'Trail Slayer', [createComponent('comp-1')]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      expect(screen.getByText('Trail Slayer')).toBeInTheDocument();
    });

    it('renders multiple bikes', () => {
      const bikes = [
        createBike('bike-1', 'Trail Bike', [createComponent('comp-1')]),
        createBike('bike-2', 'Enduro Bike', [createComponent('comp-2')]),
      ];
      setupCalibrationState(bikes);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      expect(screen.getByText('Trail Bike')).toBeInTheDocument();
      expect(screen.getByText('Enduro Bike')).toBeInTheDocument();
    });
  });

  describe('bike section expansion', () => {
    it('expands first bike by default', () => {
      const bike = createBike('bike-1', 'Trail Bike', [
        createComponent('comp-1', { brand: 'Fox', model: '36' }),
      ]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      // The component details should be visible (bulk action section)
      expect(screen.getByText('Mark all overdue serviced in:')).toBeInTheDocument();
    });

    it('toggles bike section on click', () => {
      const bike = createBike('bike-1', 'Trail Bike', [createComponent('comp-1')]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      // Initially expanded
      expect(screen.getByText('Mark all overdue serviced in:')).toBeInTheDocument();

      // Click to collapse
      fireEvent.click(screen.getByText('Trail Bike'));

      // Content should be hidden
      expect(screen.queryByText('Mark all overdue serviced in:')).not.toBeInTheDocument();

      // Click to expand again
      fireEvent.click(screen.getByText('Trail Bike'));

      // Content should be visible again
      expect(screen.getByText('Mark all overdue serviced in:')).toBeInTheDocument();
    });
  });

  describe('bulk service action', () => {
    it('renders bulk action with month input and checkbox', () => {
      const bike = createBike('bike-1', 'Trail Bike', [createComponent('comp-1')]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      // Should have month input (input type="month" doesn't have a textbox role)
      const monthInput = document.querySelector('input[type="month"]');
      expect(monthInput).toBeInTheDocument();

      // Should have the bulk Log Service button (needs-attention rows are
      // pre-selected on open, so the count reflects the one component)
      expect(screen.getByText(/Log Service \(1\)/)).toBeInTheDocument();
    });

    it('marks components as calibrated on bulk Log Service and submits on Complete', async () => {
      const bike = createBike('bike-1', 'Trail Bike', [
        createComponent('comp-1'),
        createComponent('comp-2'),
      ]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      // Click the bulk Log Service button (both rows pre-selected on open)
      fireEvent.click(screen.getByText(/Log Service \(2\)/));

      // Progress should update (components marked locally)
      await waitFor(() => {
        expect(screen.getByText('2 of 2 calibrated')).toBeInTheDocument();
      });

      // Now click Complete Calibration to submit
      fireEvent.click(screen.getByText('Done'));

      await waitFor(() => {
        expect(mockLogBulkService).toHaveBeenCalledTimes(1);
        expect(mockLogBulkService).toHaveBeenCalledWith({
          variables: {
            input: {
              componentIds: ['comp-1', 'comp-2'],
              performedAt: expect.any(String),
            },
          },
        });
      });
    });

    it('shows success message after bulk service', async () => {
      const bike = createBike('bike-1', 'Trail Bike', [createComponent('comp-1')]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      fireEvent.click(screen.getByText(/Log Service \(1\)/));

      await waitFor(() => {
        expect(screen.getByText(/Marked 1 component as serviced/)).toBeInTheDocument();
      });
    });

    it('updates progress after applying bulk service date', async () => {
      const bike = createBike('bike-1', 'Trail Bike', [
        createComponent('comp-1'),
        createComponent('comp-2'),
      ]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      expect(screen.getByText('0 of 2 calibrated')).toBeInTheDocument();

      fireEvent.click(screen.getByText(/Log Service \(2\)/));

      await waitFor(() => {
        expect(screen.getByText('2 of 2 calibrated')).toBeInTheDocument();
      });
    });
  });

  describe('state freeze across refetch', () => {
    it('preserves in-progress calibration when calibrationState refetches mid-session', async () => {
      const bike = createBike('bike-1', 'Trail Bike', [
        createComponent('comp-1'),
        createComponent('comp-2'),
      ]);
      setupCalibrationState([bike]);

      const { rerender } = render(
        <CalibrationOverlay isOpen={true} onClose={defaultOnClose} />
      );

      // Stage work: acknowledge one component.
      const acknowledgeButtons = screen.getAllByRole('button', { name: 'Acknowledge' });
      fireEvent.click(acknowledgeButtons[0]);
      await waitFor(() => {
        expect(screen.getByText('1 of 2 calibrated')).toBeInTheDocument();
      });

      // Simulate a `cache-and-network` background refetch: Apollo hands back
      // a brand-new calibrationState object reference (same underlying data).
      setupCalibrationState([
        createBike('bike-1', 'Trail Bike', [
          createComponent('comp-1'),
          createComponent('comp-2'),
        ]),
      ]);
      rerender(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      // The staged calibration must survive — the init effect is guarded so
      // it does not re-run and wipe calibratedIds / pendingServiceLogs.
      await waitFor(() => {
        expect(screen.getByText('1 of 2 calibrated')).toBeInTheDocument();
      });
      expect(screen.getByText('Calibrated')).toBeInTheDocument();
    });
  });

  describe('individual component actions', () => {
    it('renders Acknowledge and Snooze buttons for each uncalibrated component', () => {
      const bike = createBike('bike-1', 'Trail Bike', [
        createComponent('comp-1'),
        createComponent('comp-2'),
      ]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      // Use getAllByRole to find buttons specifically (not text in explanation)
      const acknowledgeButtons = screen.getAllByRole('button', { name: 'Acknowledge' });
      const snoozeButtons = screen.getAllByRole('button', { name: /Snooze/ });
      expect(acknowledgeButtons).toHaveLength(2);
      expect(snoozeButtons).toHaveLength(2);
    });

    it('marks component as calibrated on Acknowledge click', async () => {
      const bike = createBike('bike-1', 'Trail Bike', [
        createComponent('comp-1'),
        createComponent('comp-2'),
      ]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      // Click the first Acknowledge button
      const acknowledgeButtons = screen.getAllByRole('button', { name: 'Acknowledge' });
      fireEvent.click(acknowledgeButtons[0]);

      // One component should be calibrated, progress should update
      await waitFor(() => {
        expect(screen.getByText('Calibrated')).toBeInTheDocument();
        expect(screen.getByText('1 of 2 calibrated')).toBeInTheDocument();
      });
    });

    it('calls snoozeComponent on Snooze click', async () => {
      const bike = createBike('bike-1', 'Trail Bike', [createComponent('comp-1')]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      // Use getByRole to find button specifically
      fireEvent.click(screen.getByRole('button', { name: /Snooze/ }));

      await waitFor(() => {
        expect(mockSnoozeComponent).toHaveBeenCalledWith({
          variables: { id: 'comp-1' },
        });
      });
    });

    it('shows calibrated state after Snooze click', async () => {
      const bike = createBike('bike-1', 'Trail Bike', [
        createComponent('comp-1'),
        createComponent('comp-2'),
      ]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      // Click the first Snooze button
      const snoozeButtons = screen.getAllByRole('button', { name: /Snooze/ });
      fireEvent.click(snoozeButtons[0]);

      await waitFor(() => {
        expect(screen.getByText('Calibrated')).toBeInTheDocument();
        expect(screen.getByText('1 of 2 calibrated')).toBeInTheDocument();
      });
    });
  });

  describe('footer actions', () => {
    it('renders Remind Me Later button', () => {
      const bike = createBike('bike-1', 'Trail Bike', [createComponent('comp-1')]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      expect(screen.getByText('Remind Me Later')).toBeInTheDocument();
    });

    it('renders Complete Calibration when components remain', () => {
      const bike = createBike('bike-1', 'Trail Bike', [createComponent('comp-1')]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      expect(screen.getByText('Complete Calibration')).toBeInTheDocument();
    });

    it('renders Done when all components calibrated', async () => {
      const bike = createBike('bike-1', 'Trail Bike', [createComponent('comp-1')]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      // Acknowledge the component (use getByRole to find button specifically)
      fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));

      await waitFor(() => {
        expect(screen.getByText('Done')).toBeInTheDocument();
      });
    });

    it('calls dismissCalibration and onClose on Remind Me Later', async () => {
      const onClose = vi.fn();
      const bike = createBike('bike-1', 'Trail Bike', [createComponent('comp-1')]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={onClose} />);

      fireEvent.click(screen.getByText('Remind Me Later'));

      await waitFor(() => {
        expect(mockDismissCalibration).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
      });
    });

    it('calls completeCalibration and onClose on Complete Calibration', async () => {
      const onClose = vi.fn();
      const bike = createBike('bike-1', 'Trail Bike', [createComponent('comp-1')]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={onClose} />);

      fireEvent.click(screen.getByText('Complete Calibration'));

      await waitFor(() => {
        expect(mockCompleteCalibration).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
      });
    });
  });

  describe('component selection', () => {
    it('has checkboxes for each uncalibrated component', () => {
      const bike = createBike('bike-1', 'Trail Bike', [
        createComponent('comp-1'),
        createComponent('comp-2'),
      ]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      // Each component should have a checkbox (plus the select all checkbox)
      const checkboxes = screen.getAllByRole('checkbox');
      // 1 select-all checkbox + 2 component checkboxes = 3 total
      expect(checkboxes.length).toBe(3);
    });

    it('can deselect components from bulk action', async () => {
      const bike = createBike('bike-1', 'Trail Bike', [
        createComponent('comp-1'),
        createComponent('comp-2'),
      ]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      // Needs-attention rows are pre-selected on open, so the bulk button
      // starts at Log Service (2)
      expect(screen.getByText(/Log Service \(2\)/)).toBeInTheDocument();

      // Deselect one component (component checkboxes are after the select-all)
      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[1]); // First component checkbox

      // Button should now show Log Service (1)
      await waitFor(() => {
        expect(screen.getByText(/Log Service \(1\)/)).toBeInTheDocument();
      });
    });

    it('select-all is scoped to needs-attention rows, not healthy ones', async () => {
      // OVERDUE sorts before ALL_GOOD, so checkbox order is:
      // [0] header select-all, [1] comp-1 (OVERDUE), [2] comp-2 (ALL_GOOD).
      const bike = createBike('bike-1', 'Trail Bike', [
        createComponent('comp-1', { status: 'OVERDUE' }),
        createComponent('comp-2', { status: 'ALL_GOOD', hoursRemaining: 40 }),
      ]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      // Only the OVERDUE row is pre-selected on open — the ALL_GOOD one is
      // not swept in. Subtitle counts needs-attention only.
      expect(screen.getByText(/Log Service \(1\)/)).toBeInTheDocument();
      expect(screen.getByTestId('subtitle')).toHaveTextContent(
        '1 component needs attention'
      );

      // Header checkbox is checked (every needs-attention row is selected);
      // toggling it off clears only the needs-attention selection.
      expect(screen.getAllByRole('checkbox')[0]).toBeChecked();
      fireEvent.click(screen.getAllByRole('checkbox')[0]);
      await waitFor(() => {
        expect(screen.getByText(/Log Service \(0\)/)).toBeInTheDocument();
      });

      // The healthy component is still selectable individually — servicing
      // an "all good" component (a creak, a sloppy bleed) is a real case.
      fireEvent.click(screen.getAllByRole('checkbox')[2]);
      await waitFor(() => {
        expect(screen.getByText(/Log Service \(1\)/)).toBeInTheDocument();
      });
      // Selecting the healthy row does not check the header checkbox — the
      // header tracks needs-attention rows only.
      expect(screen.getAllByRole('checkbox')[0]).not.toBeChecked();
    });
  });

  describe('date selection', () => {
    it('has a month input for bulk date selection', () => {
      const bike = createBike('bike-1', 'Trail Bike', [createComponent('comp-1')]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      // Should have an input type="month"
      const monthInput = document.querySelector('input[type="month"]');
      expect(monthInput).toBeInTheDocument();
    });

    it('can change the bulk date', () => {
      const bike = createBike('bike-1', 'Trail Bike', [createComponent('comp-1')]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      const monthInput = document.querySelector('input[type="month"]') as HTMLInputElement;

      // Change to a specific month
      fireEvent.change(monthInput, { target: { value: '2024-06' } });

      expect(monthInput.value).toBe('2024-06');
    });
  });
});
