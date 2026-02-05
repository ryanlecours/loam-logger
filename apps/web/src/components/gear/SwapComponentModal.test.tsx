import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SwapComponentModal } from './SwapComponentModal';

// Mock useMutation
const mockSwapComponents = vi.fn();
vi.mock('@apollo/client', () => ({
  useMutation: vi.fn(() => [mockSwapComponents, { loading: false }]),
  gql: vi.fn((strings: TemplateStringsArray) => strings[0]),
}));

// Mock Modal
vi.mock('../ui/Modal', () => ({
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
    size?: string;
  }) =>
    isOpen ? (
      <div data-testid="modal">
        <h2>{title}</h2>
        {subtitle && <p data-testid="modal-subtitle">{subtitle}</p>}
        <button onClick={onClose} data-testid="modal-close">
          Close
        </button>
        {children}
      </div>
    ) : null,
}));

// Mock Button
vi.mock('../ui/Button', () => ({
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
    size?: string;
  }) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant}>
      {children}
    </button>
  ),
}));

// Mock getSlotKey
vi.mock('@loam/shared', () => ({
  getSlotKey: (type: string, location: string) => `${type}_${location}`,
}));

// Mock formatters
vi.mock('../../utils/formatters', () => ({
  formatComponentLabel: (comp: { componentType: string; location?: string | null }) =>
    comp.location ? `${comp.componentType} (${comp.location})` : comp.componentType,
  getBikeName: (bike: { nickname?: string | null; manufacturer: string; model: string }) =>
    bike.nickname || `${bike.manufacturer} ${bike.model}`,
}));

describe('SwapComponentModal', () => {
  const defaultComponent = {
    id: 'comp-a',
    type: 'FORK',
    location: null,
    brand: 'RockShox',
    model: 'Pike',
    hoursUsed: 50,
  };

  const otherBikes = [
    {
      id: 'bike-2',
      nickname: 'Enduro Sled',
      manufacturer: 'Specialized',
      model: 'Enduro',
      components: [
        {
          id: 'comp-b',
          type: 'FORK',
          location: null,
          brand: 'Fox',
          model: '38 Factory',
          hoursUsed: 25.3,
          isStock: false,
        },
        {
          id: 'comp-c',
          type: 'SHOCK',
          location: null,
          brand: 'Fox',
          model: 'Float X2',
          hoursUsed: 12,
          isStock: false,
        },
      ],
    },
    {
      id: 'bike-3',
      nickname: null,
      manufacturer: 'Santa Cruz',
      model: 'Megatower',
      components: [
        {
          id: 'comp-d',
          type: 'FORK',
          location: null,
          brand: 'RockShox',
          model: 'ZEB',
          hoursUsed: 80,
          isStock: true,
        },
      ],
    },
  ];

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    bikeId: 'bike-1',
    bikeName: '2024 Slash',
    component: defaultComponent,
    otherBikes,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSwapComponents.mockResolvedValue({
      data: {
        swapComponents: {
          componentA: { id: 'comp-a' },
          componentB: { id: 'comp-b' },
        },
      },
    });
  });

  describe('rendering', () => {
    it('renders when open', () => {
      render(<SwapComponentModal {...defaultProps} />);
      expect(screen.getByTestId('modal')).toBeInTheDocument();
    });

    it('does not render when closed', () => {
      render(<SwapComponentModal {...defaultProps} isOpen={false} />);
      expect(screen.queryByTestId('modal')).not.toBeInTheDocument();
    });

    it('shows compatibility warning', () => {
      render(<SwapComponentModal {...defaultProps} />);
      expect(
        screen.getByText(/Compatibility is not validated/)
      ).toBeInTheDocument();
    });
  });

  describe('matching components', () => {
    it('shows only bikes with matching component type (FORK)', () => {
      render(<SwapComponentModal {...defaultProps} />);
      // Both other bikes have FORK components
      expect(screen.getByText('Enduro Sled')).toBeInTheDocument();
      expect(screen.getByText('Santa Cruz Megatower')).toBeInTheDocument();
    });

    it('shows component brand/model and hours for each match', () => {
      render(<SwapComponentModal {...defaultProps} />);
      expect(screen.getByText(/Fox 38 Factory/)).toBeInTheDocument();
      expect(screen.getByText(/25.3h used/)).toBeInTheDocument();
      expect(screen.getByText(/RockShox ZEB/)).toBeInTheDocument();
      expect(screen.getByText(/80.0h used/)).toBeInTheDocument();
    });

    it('shows swap button for each matching entry', () => {
      render(<SwapComponentModal {...defaultProps} />);
      const swapButtons = screen.getAllByText('Swap');
      expect(swapButtons).toHaveLength(2);
    });

    it('shows empty state when no matching components on other bikes', () => {
      render(
        <SwapComponentModal
          {...defaultProps}
          otherBikes={[
            {
              id: 'bike-2',
              nickname: null,
              manufacturer: 'Spec',
              model: 'Enduro',
              components: [
                {
                  id: 'comp-x',
                  type: 'SHOCK', // Different type
                  location: null,
                  brand: 'Fox',
                  model: 'Float',
                  hoursUsed: 10,
                  isStock: false,
                },
              ],
            },
          ]}
        />
      );
      expect(
        screen.getByText(/No other bikes have a fork installed/)
      ).toBeInTheDocument();
    });
  });

  describe('swap action', () => {
    it('calls swapComponents mutation with correct slot keys', async () => {
      render(<SwapComponentModal {...defaultProps} />);

      // Click the first Swap button (Enduro Sled's Fox 38)
      const swapButtons = screen.getAllByText('Swap');
      fireEvent.click(swapButtons[0]);

      await waitFor(() => {
        expect(mockSwapComponents).toHaveBeenCalledWith({
          variables: {
            input: {
              bikeIdA: 'bike-1',
              slotKeyA: 'FORK_NONE',
              bikeIdB: 'bike-2',
              slotKeyB: 'FORK_NONE',
            },
          },
        });
      });
    });

    it('calls onClose after successful swap', async () => {
      render(<SwapComponentModal {...defaultProps} />);

      const swapButtons = screen.getAllByText('Swap');
      fireEvent.click(swapButtons[0]);

      await waitFor(() => {
        expect(defaultProps.onClose).toHaveBeenCalled();
      });
    });

    it('shows error message on failure', async () => {
      mockSwapComponents.mockRejectedValue(
        new Error('Failed to swap components. Please try again.')
      );

      render(<SwapComponentModal {...defaultProps} />);

      const swapButtons = screen.getAllByText('Swap');
      fireEvent.click(swapButtons[0]);

      await waitFor(() => {
        expect(
          screen.getByText('Failed to swap components. Please try again.')
        ).toBeInTheDocument();
      });
    });

    it('shows Swapping... text while mutation is in progress', async () => {
      // Make the mutation hang
      mockSwapComponents.mockImplementation(
        () => new Promise(() => {}) // never resolves
      );

      render(<SwapComponentModal {...defaultProps} />);

      const swapButtons = screen.getAllByText('Swap');
      fireEvent.click(swapButtons[0]);

      await waitFor(() => {
        expect(screen.getByText('Swapping...')).toBeInTheDocument();
      });
    });

    it('disables other swap buttons while swapping', async () => {
      mockSwapComponents.mockImplementation(
        () => new Promise(() => {})
      );

      render(<SwapComponentModal {...defaultProps} />);

      const swapButtons = screen.getAllByText('Swap');
      fireEvent.click(swapButtons[0]);

      await waitFor(() => {
        // The second button should be disabled
        const remainingButtons = screen.getAllByRole('button').filter(
          (btn) => btn.textContent === 'Swap'
        );
        remainingButtons.forEach((btn) => {
          expect(btn).toBeDisabled();
        });
      });
    });
  });
});
