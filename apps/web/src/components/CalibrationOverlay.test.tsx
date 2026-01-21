import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CalibrationOverlay } from './CalibrationOverlay';
import type { BikeCalibrationInfo } from '../graphql/calibration';
import type { ComponentPrediction } from '../types/prediction';

// Mock the GraphQL hooks
const mockLogBulkService = vi.fn();
const mockDismissCalibration = vi.fn();
const mockCompleteCalibration = vi.fn();
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
      expect(screen.getByText('All serviced in:')).toBeInTheDocument();
    });

    it('toggles bike section on click', () => {
      const bike = createBike('bike-1', 'Trail Bike', [createComponent('comp-1')]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      // Initially expanded
      expect(screen.getByText('All serviced in:')).toBeInTheDocument();

      // Click to collapse
      fireEvent.click(screen.getByText('Trail Bike'));

      // Content should be hidden
      expect(screen.queryByText('All serviced in:')).not.toBeInTheDocument();

      // Click to expand again
      fireEvent.click(screen.getByText('Trail Bike'));

      // Content should be visible again
      expect(screen.getByText('All serviced in:')).toBeInTheDocument();
    });
  });

  describe('bulk service action', () => {
    it('renders bulk action with month/year selectors', () => {
      const bike = createBike('bike-1', 'Trail Bike', [createComponent('comp-1')]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      // Should have month and year dropdowns
      const selects = screen.getAllByRole('combobox');
      expect(selects.length).toBe(2);

      // Should have Apply button
      expect(screen.getByText('Apply to All (1)')).toBeInTheDocument();
    });

    it('calls logBulkService with correct data on Apply', async () => {
      const bike = createBike('bike-1', 'Trail Bike', [
        createComponent('comp-1'),
        createComponent('comp-2'),
      ]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      // Click Apply button
      fireEvent.click(screen.getByText('Apply to All (2)'));

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

      fireEvent.click(screen.getByText('Apply to All (1)'));

      await waitFor(() => {
        expect(screen.getByText(/Logged service for 1 component/)).toBeInTheDocument();
      });
    });

    it('shows error message on bulk service failure', async () => {
      mockLogBulkService.mockRejectedValue(new Error('Network error'));

      const bike = createBike('bike-1', 'Trail Bike', [createComponent('comp-1')]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      fireEvent.click(screen.getByText('Apply to All (1)'));

      await waitFor(() => {
        expect(
          screen.getByText('Failed to log service. Please try again.')
        ).toBeInTheDocument();
      });
    });

    it('updates progress after successful bulk service', async () => {
      const bike = createBike('bike-1', 'Trail Bike', [
        createComponent('comp-1'),
        createComponent('comp-2'),
      ]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      expect(screen.getByText('0 of 2 calibrated')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Apply to All (2)'));

      await waitFor(() => {
        expect(screen.getByText('2 of 2 calibrated')).toBeInTheDocument();
      });
    });
  });

  describe('individual component actions', () => {
    it('renders Good button for each uncalibrated component', () => {
      const bike = createBike('bike-1', 'Trail Bike', [
        createComponent('comp-1'),
        createComponent('comp-2'),
      ]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      const goodButtons = screen.getAllByText('Good');
      expect(goodButtons).toHaveLength(2);
    });

    it('calls logBulkService with single component on Good click', async () => {
      const bike = createBike('bike-1', 'Trail Bike', [createComponent('comp-1')]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      fireEvent.click(screen.getByText('Good'));

      await waitFor(() => {
        expect(mockLogBulkService).toHaveBeenCalledWith({
          variables: {
            input: {
              componentIds: ['comp-1'],
              performedAt: expect.any(String),
            },
          },
        });
      });
    });

    it('shows calibrated state after Good click', async () => {
      const bike = createBike('bike-1', 'Trail Bike', [
        createComponent('comp-1'),
        createComponent('comp-2'),
      ]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      // Click the first Good button
      const goodButtons = screen.getAllByText('Good');
      fireEvent.click(goodButtons[0]);

      // When one component is calibrated, it should show "Calibrated" text
      // and the progress should update to 1 of 2
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

    it('renders Finish Anyway when components remain', () => {
      const bike = createBike('bike-1', 'Trail Bike', [createComponent('comp-1')]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      expect(screen.getByText('Finish Anyway')).toBeInTheDocument();
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

    it('calls completeCalibration and onClose on Finish Anyway', async () => {
      const onClose = vi.fn();
      const bike = createBike('bike-1', 'Trail Bike', [createComponent('comp-1')]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={onClose} />);

      fireEvent.click(screen.getByText('Finish Anyway'));

      await waitFor(() => {
        expect(mockCompleteCalibration).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
      });
    });
  });

  describe('date selection', () => {
    it('changes bulk date when month dropdown changes', () => {
      const bike = createBike('bike-1', 'Trail Bike', [createComponent('comp-1')]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      const selects = screen.getAllByRole('combobox');
      const monthSelect = selects[0];

      // Change to March (index 2)
      fireEvent.change(monthSelect, { target: { value: '2' } });

      expect(monthSelect).toHaveValue('2');
    });

    it('changes bulk date when year dropdown changes', () => {
      const bike = createBike('bike-1', 'Trail Bike', [createComponent('comp-1')]);
      setupCalibrationState([bike]);

      render(<CalibrationOverlay isOpen={true} onClose={defaultOnClose} />);

      const selects = screen.getAllByRole('combobox');
      const yearSelect = selects[1];

      // Change to a different year
      const targetYear = new Date().getFullYear() - 1;
      fireEvent.change(yearSelect, { target: { value: String(targetYear) } });

      expect(yearSelect).toHaveValue(String(targetYear));
    });
  });
});
