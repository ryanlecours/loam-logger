import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LogServiceModal } from './LogServiceModal';
import type { BikeWithPredictions } from '../../hooks/usePriorityBike';
import type { BikePredictionSummary, ComponentPrediction } from '../../types/prediction';

// Mock useMutation from Apollo Client to avoid React 19 compatibility issues
const mockLogService = vi.fn();
vi.mock('@apollo/client', () => ({
  useMutation: vi.fn(() => [mockLogService, { loading: false }]),
  gql: vi.fn((strings: TemplateStringsArray) => strings[0]),
}));

// Mock the Modal to avoid createPortal issues
vi.mock('../ui/Modal', () => ({
  Modal: ({ isOpen, onClose, title, children }: {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
  }) => isOpen ? (
    <div data-testid="modal">
      <h2>{title}</h2>
      <button onClick={onClose} data-testid="modal-close">Close</button>
      {children}
    </div>
  ) : null,
}));

// Mock Button component
vi.mock('../ui/Button', () => ({
  Button: ({ children, onClick, disabled, variant }: {
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
vi.mock('./StatusDot', () => ({
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
  status: 'DUE_SOON',
  hoursRemaining: 15.5,
  ridesRemainingEstimate: 5,
  confidence: 'HIGH',
  currentHours: 35,
  serviceIntervalHours: 50,
  hoursSinceService: 35,
  why: null,
  drivers: null,
  ...overrides,
});

// Factory for creating test bikes
const createBike = (
  components: ComponentPrediction[] = []
): BikeWithPredictions => ({
  id: 'bike-1',
  nickname: 'Trail Slayer',
  manufacturer: 'Trek',
  model: 'Slash',
  thumbnailUrl: null,
  sortOrder: 0,
  predictions: {
    bikeId: 'bike-1',
    bikeName: 'Trail Slayer',
    components,
    priorityComponent: components[0] ?? null,
    overallStatus: 'DUE_SOON',
    dueNowCount: 0,
    dueSoonCount: components.length,
    generatedAt: new Date().toISOString(),
  } as BikePredictionSummary,
});

// Get today's date in YYYY-MM-DD format
const getTodayDate = () => new Date().toISOString().split('T')[0];

describe('LogServiceModal', () => {
  const components = [
    createComponent('comp-1', { componentType: 'FORK', hoursRemaining: 10.5 }),
    createComponent('comp-2', { componentType: 'SHOCK', hoursRemaining: 20.3 }),
  ];

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    bike: createBike(components),
    defaultComponentId: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogService.mockReset();
    mockLogService.mockResolvedValue({
      data: {
        logComponentService: {
          id: 'comp-1',
          hoursUsed: 0,
          updatedAt: new Date().toISOString(),
        },
      },
    });
  });

  describe('rendering', () => {
    it('returns null when bike is null', () => {
      const { container } = render(
        <LogServiceModal {...defaultProps} bike={null} />
      );

      expect(container.firstChild).toBeNull();
    });

    it('renders modal with correct title', () => {
      render(<LogServiceModal {...defaultProps} />);

      expect(screen.getByText('Log Service')).toBeInTheDocument();
    });

    it('renders bike name', () => {
      render(<LogServiceModal {...defaultProps} />);

      expect(screen.getByText('Trail Slayer')).toBeInTheDocument();
    });

    it('renders all components from predictions', () => {
      render(<LogServiceModal {...defaultProps} />);

      expect(screen.getByText('10.5 hrs')).toBeInTheDocument();
      expect(screen.getByText('20.3 hrs')).toBeInTheDocument();
    });
  });

  describe('date picker', () => {
    it('renders date input with today as default', () => {
      render(<LogServiceModal {...defaultProps} />);

      const dateInput = screen.getByLabelText('Service date') as HTMLInputElement;
      expect(dateInput.value).toBe(getTodayDate());
    });

    it('date input has max set to today', () => {
      render(<LogServiceModal {...defaultProps} />);

      const dateInput = screen.getByLabelText('Service date');
      expect(dateInput).toHaveAttribute('max', getTodayDate());
    });

    it('updates serviceDate on date change', () => {
      render(<LogServiceModal {...defaultProps} />);

      const dateInput = screen.getByLabelText('Service date') as HTMLInputElement;
      fireEvent.change(dateInput, { target: { value: '2024-01-15' } });

      expect(dateInput.value).toBe('2024-01-15');
    });
  });

  describe('component selection', () => {
    it('toggles component selection on click', () => {
      render(<LogServiceModal {...defaultProps} />);

      const firstItem = screen.getAllByRole('checkbox')[0];
      expect(firstItem).toHaveAttribute('aria-checked', 'false');

      fireEvent.click(firstItem);
      expect(firstItem).toHaveAttribute('aria-checked', 'true');

      fireEvent.click(firstItem);
      expect(firstItem).toHaveAttribute('aria-checked', 'false');
    });

    it('toggles component selection on Enter key', () => {
      render(<LogServiceModal {...defaultProps} />);

      const firstItem = screen.getAllByRole('checkbox')[0];
      expect(firstItem).toHaveAttribute('aria-checked', 'false');

      fireEvent.keyDown(firstItem, { key: 'Enter' });
      expect(firstItem).toHaveAttribute('aria-checked', 'true');
    });

    it('toggles component selection on Space key', () => {
      render(<LogServiceModal {...defaultProps} />);

      const firstItem = screen.getAllByRole('checkbox')[0];
      expect(firstItem).toHaveAttribute('aria-checked', 'false');

      fireEvent.keyDown(firstItem, { key: ' ' });
      expect(firstItem).toHaveAttribute('aria-checked', 'true');
    });

    it('allows multiple components selected', () => {
      render(<LogServiceModal {...defaultProps} />);

      const checkboxes = screen.getAllByRole('checkbox');

      fireEvent.click(checkboxes[0]);
      fireEvent.click(checkboxes[1]);

      expect(checkboxes[0]).toHaveAttribute('aria-checked', 'true');
      expect(checkboxes[1]).toHaveAttribute('aria-checked', 'true');
    });

    it('applies selected class to selected items', () => {
      render(<LogServiceModal {...defaultProps} />);

      const firstItem = screen.getAllByRole('checkbox')[0];

      expect(firstItem).not.toHaveClass('log-service-item-selected');

      fireEvent.click(firstItem);

      expect(firstItem).toHaveClass('log-service-item-selected');
    });
  });

  describe('submit button', () => {
    it('disables submit when no components selected', () => {
      render(<LogServiceModal {...defaultProps} />);

      const submitButton = screen.getByRole('button', { name: /Log Service \(0\)/ });
      expect(submitButton).toBeDisabled();
    });

    it('shows correct count in button text', () => {
      render(<LogServiceModal {...defaultProps} />);

      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[0]);

      expect(screen.getByText('Log Service (1)')).toBeInTheDocument();

      fireEvent.click(checkboxes[1]);

      expect(screen.getByText('Log Service (2)')).toBeInTheDocument();
    });

    it('calls logService mutation for each selected component', async () => {
      render(<LogServiceModal {...defaultProps} />);

      // Select both components
      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[0]);
      fireEvent.click(checkboxes[1]);

      // Submit
      const submitButton = screen.getByText('Log Service (2)');
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockLogService).toHaveBeenCalledTimes(2);
      });
    });

    it('passes performedAt (serviceDate) to mutation', async () => {
      render(<LogServiceModal {...defaultProps} />);

      // Change date
      const dateInput = screen.getByLabelText('Service date');
      fireEvent.change(dateInput, { target: { value: '2024-01-15' } });

      // Select component
      const checkbox = screen.getAllByRole('checkbox')[0];
      fireEvent.click(checkbox);

      // Submit
      const submitButton = screen.getByText('Log Service (1)');
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockLogService).toHaveBeenCalledWith({
          variables: { id: 'comp-1', performedAt: '2024-01-15' },
        });
      });
    });

    it('calls onClose after success', async () => {
      const onClose = vi.fn();
      render(<LogServiceModal {...defaultProps} onClose={onClose} />);

      // Select component and submit
      fireEvent.click(screen.getAllByRole('checkbox')[0]);
      fireEvent.click(screen.getByText('Log Service (1)'));

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });
    });
  });

  describe('pre-selection', () => {
    it('pre-selects defaultComponentId when provided', () => {
      render(
        <LogServiceModal {...defaultProps} defaultComponentId="comp-1" />
      );

      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes[0]).toHaveAttribute('aria-checked', 'true');
      expect(checkboxes[1]).toHaveAttribute('aria-checked', 'false');
    });
  });

  describe('error handling', () => {
    it('shows error message on mutation failure', async () => {
      mockLogService.mockRejectedValue(new Error('Network error'));

      render(<LogServiceModal {...defaultProps} />);

      // Select component and submit
      fireEvent.click(screen.getAllByRole('checkbox')[0]);
      fireEvent.click(screen.getByText('Log Service (1)'));

      await waitFor(() => {
        expect(screen.getByText('Failed to log service. Please try again.')).toBeInTheDocument();
      });
    });
  });

  describe('cancel button', () => {
    it('calls onClose when Cancel clicked', () => {
      const onClose = vi.fn();
      render(
        <LogServiceModal {...defaultProps} onClose={onClose} />
      );

      fireEvent.click(screen.getByText('Cancel'));

      expect(onClose).toHaveBeenCalled();
    });
  });
});
