import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import BikeDetail from './BikeDetail';
import type { PredictionStatus } from '@/types/prediction';

// Mock Apollo Client
const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn();

vi.mock('@apollo/client', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
  gql: vi.fn((strings: TemplateStringsArray) => strings[0]),
}));

// Mock motion
vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<React.HTMLAttributes<HTMLDivElement>>) => (
      <div {...props}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren<object>) => <>{children}</>,
}));

// Mock components
vi.mock('@/components/ui/Button', () => ({
  Button: ({ children, onClick, variant, size }: {
    children: React.ReactNode;
    onClick?: () => void;
    variant?: string;
    size?: string;
  }) => (
    <button onClick={onClick} data-variant={variant} data-size={size}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ isOpen, onClose, title, children }: {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
  }) => isOpen ? (
    <div data-testid="modal" role="dialog">
      <h2>{title}</h2>
      <button onClick={onClose} data-testid="modal-close">Close</button>
      {children}
    </div>
  ) : null,
}));

vi.mock('@/components/BikeForm', () => ({
  BikeForm: ({ onSubmit, onClose }: { onSubmit: () => void; onClose: () => void }) => (
    <form data-testid="bike-form">
      <button type="button" onClick={onSubmit}>Save</button>
      <button type="button" onClick={onClose}>Cancel</button>
    </form>
  ),
}));

vi.mock('@/components/dashboard/StatusPill', () => ({
  StatusPill: ({ status }: { status: string }) => (
    <span data-testid={`status-pill-${status}`}>{status}</span>
  ),
}));

vi.mock('@/components/dashboard/LogServiceModal', () => ({
  LogServiceModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="log-service-modal">
        <button onClick={onClose}>Close Log Service</button>
      </div>
    ) : null,
}));

vi.mock('@/components/gear/ComponentDetailRow', () => ({
  ComponentDetailRow: ({ component, onEdit }: { component: { id: string; type: string }; onEdit: () => void }) => (
    <div data-testid={`component-row-${component.id}`}>
      <span>{component.type}</span>
      <button onClick={onEdit}>Edit</button>
    </div>
  ),
}));

vi.mock('@/components/gear/BikeSpecsGrid', () => ({
  BikeSpecsGrid: ({ bike }: { bike: { id: string } }) => (
    <div data-testid="bike-specs-grid">Specs for {bike.id}</div>
  ),
  EbikeSpecsGrid: ({ bike }: { bike: { isEbike?: boolean } }) =>
    bike.isEbike ? <div data-testid="ebike-specs-grid">E-bike Specs</div> : null,
}));

vi.mock('@/components/SpareComponentForm', () => ({
  SpareComponentForm: ({ onClose }: { onClose: () => void }) => (
    <form data-testid="component-form">
      <button type="button" onClick={onClose}>Cancel</button>
    </form>
  ),
}));

vi.mock('@/graphql/gear', () => ({
  GEAR_QUERY: 'GEAR_QUERY',
  UPDATE_BIKE: 'UPDATE_BIKE',
  UPDATE_COMPONENT: 'UPDATE_COMPONENT',
}));

vi.mock('@/models/BikeComponents', () => ({
  BIKE_COMPONENT_SECTIONS: [
    { key: 'fork', type: 'FORK', label: 'Fork' },
    { key: 'shock', type: 'SHOCK', label: 'Shock' },
  ],
}));

describe('BikeDetail', () => {
  const createComponent = (overrides = {}) => ({
    id: 'comp-1',
    type: 'FORK',
    brand: 'RockShox',
    model: 'Pike',
    isStock: false,
    notes: null,
    hoursUsed: 45,
    serviceDueAtHours: 50,
    ...overrides,
  });

  const createPrediction = (overrides = {}) => ({
    componentId: 'comp-1',
    componentType: 'FORK',
    status: 'DUE_SOON' as PredictionStatus,
    hoursRemaining: 5,
    ...overrides,
  });

  const createBike = (overrides = {}) => ({
    id: 'bike-1',
    manufacturer: 'Trek',
    model: 'Slash 9.8',
    year: 2024,
    nickname: 'Trail Slayer',
    travelForkMm: 160,
    travelShockMm: 150,
    notes: 'My enduro bike',
    spokesUrl: 'https://99spokes.com/trek-slash',
    thumbnailUrl: 'https://example.com/bike.jpg',
    category: 'Enduro',
    subcategory: null,
    isEbike: false,
    frameMaterial: 'Carbon',
    components: [createComponent()],
    predictions: {
      bikeId: 'bike-1',
      bikeName: 'Trail Slayer',
      components: [createPrediction()],
      priorityComponent: createPrediction(),
      overallStatus: 'DUE_SOON' as PredictionStatus,
      dueNowCount: 0,
      dueSoonCount: 1,
      generatedAt: new Date().toISOString(),
    },
    ...overrides,
  });

  const renderWithRouter = (bikeId: string) => {
    return render(
      <MemoryRouter initialEntries={[`/gear/${bikeId}`]}>
        <Routes>
          <Route path="/gear/:bikeId" element={<BikeDetail />} />
          <Route path="/gear" element={<div>Gear Page</div>} />
        </Routes>
      </MemoryRouter>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseMutation.mockReturnValue([vi.fn(), { loading: false }]);
  });

  describe('loading state', () => {
    it('shows loading message while fetching', () => {
      mockUseQuery.mockReturnValue({
        data: undefined,
        loading: true,
        error: undefined,
      });

      renderWithRouter('bike-1');

      expect(screen.getByText('Loading bike details...')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows error message when query fails', () => {
      mockUseQuery.mockReturnValue({
        data: undefined,
        loading: false,
        error: { message: 'Network error' },
      });

      renderWithRouter('bike-1');

      expect(screen.getByText(/Error loading bike: Network error/)).toBeInTheDocument();
    });

    it('shows back link in error state', () => {
      mockUseQuery.mockReturnValue({
        data: undefined,
        loading: false,
        error: { message: 'Network error' },
      });

      renderWithRouter('bike-1');

      expect(screen.getByText('Back to Bikes')).toBeInTheDocument();
    });
  });

  describe('not found state', () => {
    it('shows not found message when bike does not exist', () => {
      mockUseQuery.mockReturnValue({
        data: { bikes: [] },
        loading: false,
        error: undefined,
      });

      renderWithRouter('bike-999');

      expect(screen.getByText('Bike not found')).toBeInTheDocument();
    });

    it('shows helpful message and button', () => {
      mockUseQuery.mockReturnValue({
        data: { bikes: [] },
        loading: false,
        error: undefined,
      });

      renderWithRouter('bike-999');

      expect(screen.getByText(/doesn't exist or has been deleted/)).toBeInTheDocument();
      expect(screen.getByText('Go to My Bikes')).toBeInTheDocument();
    });
  });

  describe('bike details', () => {
    beforeEach(() => {
      mockUseQuery.mockReturnValue({
        data: { bikes: [createBike()] },
        loading: false,
        error: undefined,
      });
    });

    it('renders bike manufacturer', () => {
      renderWithRouter('bike-1');

      expect(screen.getByText('Trek')).toBeInTheDocument();
    });

    it('renders bike name with year', () => {
      renderWithRouter('bike-1');

      expect(screen.getByText('2024 Slash 9.8')).toBeInTheDocument();
    });

    it('renders nickname when present', () => {
      renderWithRouter('bike-1');

      expect(screen.getByText('"Trail Slayer"')).toBeInTheDocument();
    });

    it('renders status pill', () => {
      renderWithRouter('bike-1');

      expect(screen.getByTestId('status-pill-DUE_SOON')).toBeInTheDocument();
    });

    it('renders category badge', () => {
      renderWithRouter('bike-1');

      expect(screen.getByText('Enduro')).toBeInTheDocument();
    });

    it('renders frame material badge', () => {
      renderWithRouter('bike-1');

      expect(screen.getByText('Carbon')).toBeInTheDocument();
    });

    it('renders e-bike badge when isEbike is true', () => {
      mockUseQuery.mockReturnValue({
        data: { bikes: [createBike({ isEbike: true })] },
        loading: false,
        error: undefined,
      });

      renderWithRouter('bike-1');

      expect(screen.getByText('E-Bike')).toBeInTheDocument();
    });

    it('renders back navigation link', () => {
      renderWithRouter('bike-1');

      expect(screen.getByText('Back to Bikes')).toBeInTheDocument();
    });
  });

  describe('bike image', () => {
    it('renders image when thumbnailUrl present', () => {
      mockUseQuery.mockReturnValue({
        data: { bikes: [createBike()] },
        loading: false,
        error: undefined,
      });

      renderWithRouter('bike-1');

      const img = screen.getByAltText('Trek Slash 9.8');
      expect(img).toHaveAttribute('src', 'https://example.com/bike.jpg');
    });

    it('shows placeholder when no thumbnailUrl', () => {
      mockUseQuery.mockReturnValue({
        data: { bikes: [createBike({ thumbnailUrl: null })] },
        loading: false,
        error: undefined,
      });

      renderWithRouter('bike-1');

      const placeholder = document.querySelector('.bike-detail-hero-placeholder');
      expect(placeholder).toHaveStyle({ display: 'flex' });
    });
  });

  describe('specifications', () => {
    it('renders BikeSpecsGrid', () => {
      mockUseQuery.mockReturnValue({
        data: { bikes: [createBike()] },
        loading: false,
        error: undefined,
      });

      renderWithRouter('bike-1');

      expect(screen.getByTestId('bike-specs-grid')).toBeInTheDocument();
    });

    it('renders EbikeSpecsGrid when isEbike', () => {
      mockUseQuery.mockReturnValue({
        data: { bikes: [createBike({ isEbike: true })] },
        loading: false,
        error: undefined,
      });

      renderWithRouter('bike-1');

      expect(screen.getByTestId('ebike-specs-grid')).toBeInTheDocument();
    });

    it('does not render EbikeSpecsGrid when not ebike', () => {
      mockUseQuery.mockReturnValue({
        data: { bikes: [createBike({ isEbike: false })] },
        loading: false,
        error: undefined,
      });

      renderWithRouter('bike-1');

      expect(screen.queryByTestId('ebike-specs-grid')).not.toBeInTheDocument();
    });
  });

  describe('component health', () => {
    it('renders component health section', () => {
      mockUseQuery.mockReturnValue({
        data: { bikes: [createBike()] },
        loading: false,
        error: undefined,
      });

      renderWithRouter('bike-1');

      expect(screen.getByText('Component Health')).toBeInTheDocument();
    });

    it('renders component rows', () => {
      mockUseQuery.mockReturnValue({
        data: { bikes: [createBike()] },
        loading: false,
        error: undefined,
      });

      renderWithRouter('bike-1');

      expect(screen.getByTestId('component-row-comp-1')).toBeInTheDocument();
    });

    it('shows empty state when no components', () => {
      mockUseQuery.mockReturnValue({
        data: { bikes: [createBike({ components: [] })] },
        loading: false,
        error: undefined,
      });

      renderWithRouter('bike-1');

      expect(screen.getByText(/No components added yet/)).toBeInTheDocument();
    });

    it('sorts components by urgency', () => {
      const components = [
        createComponent({ id: 'c1', type: 'FORK' }),
        createComponent({ id: 'c2', type: 'SHOCK' }),
        createComponent({ id: 'c3', type: 'DROPPER' }),
      ];

      const predictions = [
        createPrediction({ componentId: 'c1', status: 'ALL_GOOD', hoursRemaining: 100 }),
        createPrediction({ componentId: 'c2', status: 'OVERDUE', hoursRemaining: -5 }),
        createPrediction({ componentId: 'c3', status: 'DUE_SOON', hoursRemaining: 10 }),
      ];

      mockUseQuery.mockReturnValue({
        data: {
          bikes: [createBike({
            components,
            predictions: {
              bikeId: 'bike-1',
              bikeName: 'Test',
              components: predictions,
              priorityComponent: predictions[1],
              overallStatus: 'OVERDUE' as PredictionStatus,
              dueNowCount: 1,
              dueSoonCount: 1,
              generatedAt: new Date().toISOString(),
            },
          })],
        },
        loading: false,
        error: undefined,
      });

      renderWithRouter('bike-1');

      const rows = screen.getAllByTestId(/component-row-/);
      // OVERDUE first, then DUE_SOON, then ALL_GOOD
      expect(rows[0]).toHaveAttribute('data-testid', 'component-row-c2');
      expect(rows[1]).toHaveAttribute('data-testid', 'component-row-c3');
      expect(rows[2]).toHaveAttribute('data-testid', 'component-row-c1');
    });
  });

  describe('notes section', () => {
    it('renders notes when present', () => {
      mockUseQuery.mockReturnValue({
        data: { bikes: [createBike()] },
        loading: false,
        error: undefined,
      });

      renderWithRouter('bike-1');

      expect(screen.getByText('Notes')).toBeInTheDocument();
      expect(screen.getByText('My enduro bike')).toBeInTheDocument();
    });

    it('does not render notes section when null', () => {
      mockUseQuery.mockReturnValue({
        data: { bikes: [createBike({ notes: null })] },
        loading: false,
        error: undefined,
      });

      renderWithRouter('bike-1');

      expect(screen.queryByText('Notes')).not.toBeInTheDocument();
    });
  });

  describe('external links', () => {
    it('renders 99spokes link when spokesUrl present', () => {
      mockUseQuery.mockReturnValue({
        data: { bikes: [createBike()] },
        loading: false,
        error: undefined,
      });

      renderWithRouter('bike-1');

      expect(screen.getByText('External Links')).toBeInTheDocument();
      const link = screen.getByText('View on 99spokes');
      expect(link.closest('a')).toHaveAttribute('href', 'https://99spokes.com/trek-slash');
    });

    it('does not render external links section when no spokesUrl', () => {
      mockUseQuery.mockReturnValue({
        data: { bikes: [createBike({ spokesUrl: null })] },
        loading: false,
        error: undefined,
      });

      renderWithRouter('bike-1');

      expect(screen.queryByText('External Links')).not.toBeInTheDocument();
    });
  });

  describe('action buttons', () => {
    beforeEach(() => {
      mockUseQuery.mockReturnValue({
        data: { bikes: [createBike()] },
        loading: false,
        error: undefined,
      });
    });

    it('renders Log Service button', () => {
      renderWithRouter('bike-1');

      expect(screen.getByText('Log Service')).toBeInTheDocument();
    });

    it('renders Edit Bike button', () => {
      renderWithRouter('bike-1');

      expect(screen.getByText('Edit Bike')).toBeInTheDocument();
    });

    it('opens log service modal on click', () => {
      renderWithRouter('bike-1');

      fireEvent.click(screen.getByText('Log Service'));

      expect(screen.getByTestId('log-service-modal')).toBeInTheDocument();
    });

    it('opens edit bike modal on click', () => {
      renderWithRouter('bike-1');

      fireEvent.click(screen.getByText('Edit Bike'));

      expect(screen.getByTestId('modal')).toBeInTheDocument();
      expect(screen.getByText('Edit 2024 Slash 9.8')).toBeInTheDocument();
    });
  });

  describe('edit component modal', () => {
    beforeEach(() => {
      mockUseQuery.mockReturnValue({
        data: { bikes: [createBike()] },
        loading: false,
        error: undefined,
      });
    });

    it('opens edit component modal when edit clicked', () => {
      renderWithRouter('bike-1');

      const editButton = screen.getByTestId('component-row-comp-1').querySelector('button');
      fireEvent.click(editButton!);

      expect(screen.getByTestId('component-form')).toBeInTheDocument();
    });

    it('closes edit component modal on cancel', async () => {
      renderWithRouter('bike-1');

      const editButton = screen.getByTestId('component-row-comp-1').querySelector('button');
      fireEvent.click(editButton!);

      expect(screen.getByTestId('component-form')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Cancel'));

      await waitFor(() => {
        expect(screen.queryByTestId('component-form')).not.toBeInTheDocument();
      });
    });
  });

  describe('defaults when prediction missing', () => {
    it('shows ALL_GOOD status when no predictions', () => {
      mockUseQuery.mockReturnValue({
        data: { bikes: [createBike({ predictions: null })] },
        loading: false,
        error: undefined,
      });

      renderWithRouter('bike-1');

      expect(screen.getByTestId('status-pill-ALL_GOOD')).toBeInTheDocument();
    });
  });
});
