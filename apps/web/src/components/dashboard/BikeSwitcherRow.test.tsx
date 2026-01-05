import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BikeSwitcherRow } from './BikeSwitcherRow';
import type { BikeWithPredictions } from '../../hooks/usePriorityBike';

// Mock useMutation from Apollo Client to avoid React 19 compatibility issues
const mockUpdateBikesOrder = vi.fn();
vi.mock('@apollo/client', () => ({
  useMutation: vi.fn(() => [mockUpdateBikesOrder, { loading: false }]),
  gql: vi.fn((strings: TemplateStringsArray) => strings[0]),
}));

// Mock @dnd-kit/core
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <div data-testid="dnd-context">{children}</div>,
  closestCenter: vi.fn(),
  KeyboardSensor: vi.fn(),
  PointerSensor: vi.fn(),
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
}));

// Mock @dnd-kit/sortable
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <div data-testid="sortable-context">{children}</div>,
  sortableKeyboardCoordinates: vi.fn(),
  horizontalListSortingStrategy: {},
  arrayMove: vi.fn((arr, from, to) => {
    const result = [...arr];
    const [removed] = result.splice(from, 1);
    result.splice(to, 0, removed);
    return result;
  }),
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

// Mock localStorage
const mockLocalStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: mockLocalStorage, writable: true });

// Factory for creating test bikes
const createBike = (id: string, sortOrder: number): BikeWithPredictions => ({
  id,
  nickname: `Bike ${id}`,
  manufacturer: 'Trek',
  model: 'Slash',
  thumbnailUrl: null,
  sortOrder,
  predictions: null,
});

// Helper to wrap with required providers
const renderWithProviders = (ui: React.ReactElement) => {
  return render(
    <MemoryRouter>
      {ui}
    </MemoryRouter>
  );
};

describe('BikeSwitcherRow', () => {
  const defaultProps = {
    bikes: [
      createBike('bike-1', 0),
      createBike('bike-2', 1),
      createBike('bike-3', 2),
    ],
    selectedBikeId: 'bike-1',
    onSelect: vi.fn(),
    maxVisible: 8,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLocalStorage.getItem.mockReset();
    mockLocalStorage.setItem.mockReset();
    mockUpdateBikesOrder.mockReset();
  });

  describe('rendering', () => {
    it('returns null when bikes.length <= 1', () => {
      const { container } = renderWithProviders(
        <BikeSwitcherRow {...defaultProps} bikes={[createBike('bike-1', 0)]} />
      );

      expect(container.firstChild).toBeNull();
    });

    it('returns null when bikes array is empty', () => {
      const { container } = renderWithProviders(
        <BikeSwitcherRow {...defaultProps} bikes={[]} />
      );

      expect(container.firstChild).toBeNull();
    });

    it('renders all bikes when <= maxVisible', () => {
      renderWithProviders(<BikeSwitcherRow {...defaultProps} />);

      expect(screen.getByText('Bike bike-1')).toBeInTheDocument();
      expect(screen.getByText('Bike bike-2')).toBeInTheDocument();
      expect(screen.getByText('Bike bike-3')).toBeInTheDocument();
    });

    it('renders maxVisible bikes with "+N more" when > maxVisible', () => {
      const bikes = [
        createBike('bike-1', 0),
        createBike('bike-2', 1),
        createBike('bike-3', 2),
        createBike('bike-4', 3),
        createBike('bike-5', 4),
      ];

      renderWithProviders(
        <BikeSwitcherRow {...defaultProps} bikes={bikes} maxVisible={3} />
      );

      expect(screen.getByText('Bike bike-1')).toBeInTheDocument();
      expect(screen.getByText('Bike bike-2')).toBeInTheDocument();
      expect(screen.getByText('Bike bike-3')).toBeInTheDocument();
      expect(screen.queryByText('Bike bike-4')).not.toBeInTheDocument();
      expect(screen.getByText('+2 more')).toBeInTheDocument();
    });

    it('calculates "+N" count correctly', () => {
      const bikes = Array.from({ length: 10 }, (_, i) =>
        createBike(`bike-${i}`, i)
      );

      renderWithProviders(
        <BikeSwitcherRow {...defaultProps} bikes={bikes} maxVisible={4} />
      );

      expect(screen.getByText('+6 more')).toBeInTheDocument();
    });

    it('links "+N more" to /gear page', () => {
      const bikes = Array.from({ length: 5 }, (_, i) =>
        createBike(`bike-${i}`, i)
      );

      renderWithProviders(
        <BikeSwitcherRow {...defaultProps} bikes={bikes} maxVisible={3} />
      );

      const link = screen.getByText('+2 more').closest('a');
      expect(link).toHaveAttribute('href', '/gear');
    });
  });

  describe('selection', () => {
    it('calls onSelect with bikeId when tile clicked', () => {
      const onSelect = vi.fn();
      renderWithProviders(
        <BikeSwitcherRow {...defaultProps} onSelect={onSelect} />
      );

      // Find the button containing the bike name and click it
      const bikeButton = screen.getByText('Bike bike-2').closest('button');
      fireEvent.click(bikeButton!);

      expect(onSelect).toHaveBeenCalledWith('bike-2');
    });
  });

  describe('hint system', () => {
    it('shows hint when bikes.length > 1 and not dismissed', () => {
      mockLocalStorage.getItem.mockReturnValue(null);

      renderWithProviders(<BikeSwitcherRow {...defaultProps} />);

      expect(screen.getByText('Drag to reorder your bikes')).toBeInTheDocument();
      expect(screen.getByText('Got it')).toBeInTheDocument();
    });

    it('does not show hint when localStorage key exists', () => {
      mockLocalStorage.getItem.mockReturnValue('true');

      renderWithProviders(<BikeSwitcherRow {...defaultProps} />);

      expect(screen.queryByText('Drag to reorder your bikes')).not.toBeInTheDocument();
    });

    it('dismissHint sets localStorage and hides hint', async () => {
      mockLocalStorage.getItem.mockReturnValue(null);

      renderWithProviders(<BikeSwitcherRow {...defaultProps} />);

      expect(screen.getByText('Drag to reorder your bikes')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Got it'));

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        'loam-bike-reorder-hint-dismissed',
        'true'
      );

      await waitFor(() => {
        expect(screen.queryByText('Drag to reorder your bikes')).not.toBeInTheDocument();
      });
    });

    it('uses correct localStorage key "loam-bike-reorder-hint-dismissed"', () => {
      mockLocalStorage.getItem.mockReturnValue(null);

      renderWithProviders(<BikeSwitcherRow {...defaultProps} />);

      expect(mockLocalStorage.getItem).toHaveBeenCalledWith(
        'loam-bike-reorder-hint-dismissed'
      );
    });
  });

  describe('two bikes case', () => {
    it('renders for exactly 2 bikes', () => {
      const bikes = [createBike('bike-1', 0), createBike('bike-2', 1)];

      renderWithProviders(
        <BikeSwitcherRow {...defaultProps} bikes={bikes} />
      );

      expect(screen.getByText('Bike bike-1')).toBeInTheDocument();
      expect(screen.getByText('Bike bike-2')).toBeInTheDocument();
    });
  });
});
