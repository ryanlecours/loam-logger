import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReplaceComponentModal } from './ReplaceComponentModal';

// Mock useMutation
const mockInstallComponent = vi.fn();
vi.mock('@apollo/client', () => ({
  useMutation: vi.fn(() => [mockInstallComponent, { loading: false }]),
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
    footer,
  }: {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    subtitle?: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
    size?: string;
    preventClose?: boolean;
  }) =>
    isOpen ? (
      <div data-testid="modal">
        <h2>{title}</h2>
        {subtitle && <p data-testid="modal-subtitle">{subtitle}</p>}
        <button onClick={onClose} data-testid="modal-close">
          Close
        </button>
        {children}
        {footer && <div data-testid="modal-footer">{footer}</div>}
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

// Mock getComponentLabel
vi.mock('../../constants/componentLabels', () => ({
  getComponentLabel: (type: string) => type.charAt(0) + type.slice(1).toLowerCase(),
}));

// Mock react-icons used by the component
vi.mock('react-icons/fa', () => ({
  FaExclamationTriangle: () => <span data-testid="icon-warning" />,
  FaExchangeAlt: () => <span data-testid="icon-exchange" />,
}));

describe('ReplaceComponentModal', () => {
  const defaultComponent = {
    id: 'comp-1',
    type: 'FORK',
    location: null,
    brand: 'RockShox',
    model: 'Pike',
  };

  const defaultSpares = [
    {
      id: 'spare-1',
      type: 'FORK',
      location: null,
      brand: 'Fox',
      model: '36 Factory',
      hoursUsed: 10.5,
      isStock: false,
    },
    {
      id: 'spare-2',
      type: 'FORK',
      location: null,
      brand: 'RockShox',
      model: 'Lyrik',
      hoursUsed: 0,
      isStock: false,
    },
    {
      id: 'spare-3',
      type: 'SHOCK',
      location: null,
      brand: 'Fox',
      model: 'Float X2',
      hoursUsed: 5,
      isStock: false,
    },
  ];

  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    bikeId: 'bike-1',
    bikeName: '2024 Slash',
    component: defaultComponent,
    spareComponents: defaultSpares,
    hasMultipleBikes: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockInstallComponent.mockResolvedValue({
      data: {
        installComponent: {
          installedComponent: { id: 'new-1' },
          displacedComponent: { id: 'comp-1' },
        },
      },
    });
  });

  describe('rendering', () => {
    it('renders when open', () => {
      render(<ReplaceComponentModal {...defaultProps} />);
      expect(screen.getByTestId('modal')).toBeInTheDocument();
      expect(screen.getByText('Replace Component')).toBeInTheDocument();
    });

    it('does not render when closed', () => {
      render(<ReplaceComponentModal {...defaultProps} isOpen={false} />);
      expect(screen.queryByTestId('modal')).not.toBeInTheDocument();
    });

    it('shows compatibility warning', () => {
      render(<ReplaceComponentModal {...defaultProps} />);
      expect(
        screen.getByText(/Compatibility is not validated/)
      ).toBeInTheDocument();
    });

    it('shows tab switcher', () => {
      render(<ReplaceComponentModal {...defaultProps} />);
      expect(screen.getByText('Use spare')).toBeInTheDocument();
      expect(screen.getByText('New component')).toBeInTheDocument();
    });
  });

  describe('spare tab', () => {
    it('shows only matching spare components (FORK type)', () => {
      render(<ReplaceComponentModal {...defaultProps} />);
      // Should show 2 FORK spares, not the SHOCK spare
      expect(screen.getByText('Fox 36 Factory')).toBeInTheDocument();
      expect(screen.getByText('RockShox Lyrik')).toBeInTheDocument();
      expect(screen.queryByText('Fox Float X2')).not.toBeInTheDocument();
    });

    it('shows hours used for spare components', () => {
      render(<ReplaceComponentModal {...defaultProps} />);
      expect(screen.getByText('10.5h used')).toBeInTheDocument();
      expect(screen.getByText('0h used')).toBeInTheDocument();
    });

    it('shows empty state when no matching spares', () => {
      render(
        <ReplaceComponentModal
          {...defaultProps}
          spareComponents={[defaultSpares[2]]} // Only SHOCK spare
        />
      );
      // With no matching spares, the tab defaults to 'new'. Switch to 'spare' to see empty state.
      fireEvent.click(screen.getByText('Use spare'));
      expect(
        screen.getByText(/No spare fork components/)
      ).toBeInTheDocument();
    });

    it('allows selecting a spare component', () => {
      render(<ReplaceComponentModal {...defaultProps} />);

      // Initially Confirm is disabled
      const confirmBtn = screen.getByText('Confirm');
      expect(confirmBtn).toBeDisabled();

      // Click spare
      fireEvent.click(screen.getByText('Fox 36 Factory'));

      // Confirm should now be enabled
      expect(confirmBtn).not.toBeDisabled();
    });
  });

  describe('new component tab', () => {
    it('switches to new component tab', () => {
      render(<ReplaceComponentModal {...defaultProps} />);
      fireEvent.click(screen.getByText('New component'));

      expect(screen.getByLabelText('Brand')).toBeInTheDocument();
      expect(screen.getByLabelText('Model')).toBeInTheDocument();
    });

    it('enables confirm when brand and model are filled', () => {
      render(<ReplaceComponentModal {...defaultProps} />);
      fireEvent.click(screen.getByText('New component'));

      const confirmBtn = screen.getByText('Confirm');
      expect(confirmBtn).toBeDisabled();

      fireEvent.change(screen.getByLabelText('Brand'), {
        target: { value: 'Fox' },
      });
      fireEvent.change(screen.getByLabelText('Model'), {
        target: { value: '38' },
      });

      expect(confirmBtn).not.toBeDisabled();
    });
  });

  describe('confirm action', () => {
    it('calls installComponent with existingComponentId when spare selected', async () => {
      render(<ReplaceComponentModal {...defaultProps} />);

      fireEvent.click(screen.getByText('Fox 36 Factory'));
      fireEvent.click(screen.getByText('Confirm'));

      await waitFor(() => {
        expect(mockInstallComponent).toHaveBeenCalledWith({
          variables: {
            input: {
              bikeId: 'bike-1',
              slotKey: 'FORK_NONE',
              existingComponentId: 'spare-1',
              noteText: null,
            },
          },
        });
      });
    });

    it('calls installComponent with newComponent when creating new', async () => {
      render(<ReplaceComponentModal {...defaultProps} />);
      fireEvent.click(screen.getByText('New component'));

      fireEvent.change(screen.getByLabelText('Brand'), {
        target: { value: 'Fox' },
      });
      fireEvent.change(screen.getByLabelText('Model'), {
        target: { value: '38 Factory' },
      });
      fireEvent.click(screen.getByText('Confirm'));

      await waitFor(() => {
        expect(mockInstallComponent).toHaveBeenCalledWith({
          variables: {
            input: {
              bikeId: 'bike-1',
              slotKey: 'FORK_NONE',
              newComponent: { brand: 'Fox', model: '38 Factory' },
              noteText: null,
            },
          },
        });
      });
    });

    it('calls onClose after successful replacement', async () => {
      render(<ReplaceComponentModal {...defaultProps} />);
      fireEvent.click(screen.getByText('Fox 36 Factory'));
      fireEvent.click(screen.getByText('Confirm'));

      await waitFor(() => {
        expect(defaultProps.onClose).toHaveBeenCalled();
      });
    });

    it('shows error message on failure', async () => {
      mockInstallComponent.mockRejectedValue(new Error('Network error'));

      render(<ReplaceComponentModal {...defaultProps} />);
      fireEvent.click(screen.getByText('Fox 36 Factory'));
      fireEvent.click(screen.getByText('Confirm'));

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });
  });

  describe('swap link', () => {
    it('does not show swap link when single bike', () => {
      render(<ReplaceComponentModal {...defaultProps} />);
      expect(
        screen.queryByText('Or swap with another bike')
      ).not.toBeInTheDocument();
    });

    it('shows swap link when multiple bikes and onSwapInstead provided', () => {
      const onSwapInstead = vi.fn();
      render(
        <ReplaceComponentModal
          {...defaultProps}
          hasMultipleBikes={true}
          onSwapInstead={onSwapInstead}
        />
      );
      expect(
        screen.getByText('Or swap with another bike')
      ).toBeInTheDocument();
    });

    it('calls onSwapInstead when swap link clicked', () => {
      const onSwapInstead = vi.fn();
      render(
        <ReplaceComponentModal
          {...defaultProps}
          hasMultipleBikes={true}
          onSwapInstead={onSwapInstead}
        />
      );
      fireEvent.click(screen.getByText('Or swap with another bike'));
      expect(onSwapInstead).toHaveBeenCalled();
    });
  });
});
