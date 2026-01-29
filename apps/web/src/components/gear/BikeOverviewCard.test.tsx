import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BikeOverviewCard } from './BikeOverviewCard';
import type { PredictionStatus, ComponentType, ConfidenceLevel, ComponentLocation } from '../../types/prediction';

// Mock framer-motion
vi.mock('motion/react', () => ({
  motion: {
    article: ({ children, ...props }: React.PropsWithChildren<React.HTMLAttributes<HTMLElement>>) => (
      <article {...props}>{children}</article>
    ),
  },
}));

// Mock StatusDot
vi.mock('../dashboard/StatusDot', () => ({
  StatusDot: ({ status }: { status: string }) => (
    <span data-testid={`status-dot-${status}`} />
  ),
}));

// Mock Button
vi.mock('../ui/Button', () => ({
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

// Mock KebabMenu
vi.mock('./KebabMenu', () => ({
  KebabMenu: ({ items, ariaLabel }: { items: Array<{ label: string; onClick: () => void; disabled?: boolean }>; ariaLabel: string }) => (
    <div data-testid="kebab-menu" aria-label={ariaLabel}>
      {items.map((item, i) => (
        <button
          key={i}
          onClick={item.disabled ? undefined : item.onClick}
          data-testid={`kebab-${item.label.toLowerCase().replace(' ', '-').replace('...', '')}`}
          disabled={item.disabled}
        >
          {item.label}
        </button>
      ))}
    </div>
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
    formatHoursForDisplay: () => '10.5h remaining',
    formatHoursCompact: () => '10.5h',
  }),
}));

describe('BikeOverviewCard', () => {
  const createComponent = (overrides = {}) => ({
    componentId: 'comp-1',
    componentType: 'FORK' as ComponentType,
    location: 'NONE' as ComponentLocation,
    brand: 'RockShox',
    model: 'Pike',
    status: 'DUE_SOON' as PredictionStatus,
    hoursRemaining: 10.5,
    ridesRemainingEstimate: 5,
    confidence: 'HIGH' as ConfidenceLevel,
    currentHours: 35,
    serviceIntervalHours: 50,
    hoursSinceService: 35,
    why: null,
    drivers: null,
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
    notes: 'My main enduro bike',
    thumbnailUrl: null,
    spokesUrl: 'https://99spokes.com/bike/trek-slash',
    category: 'Mountain',
    subcategory: 'Enduro',
    isEbike: false,
    frameMaterial: 'Carbon',
    components: [],
    predictions: {
      bikeId: 'bike-1',
      bikeName: 'Trail Slayer',
      components: [createComponent()],
      priorityComponent: createComponent(),
      overallStatus: 'DUE_SOON' as PredictionStatus,
      dueNowCount: 0,
      dueSoonCount: 1,
      generatedAt: new Date().toISOString(),
    },
    ...overrides,
  });

  const defaultProps = {
    bike: createBike(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onLogService: vi.fn(),
    isDeleting: false,
  };

  const renderWithRouter = (ui: React.ReactElement) => {
    return render(<MemoryRouter>{ui}</MemoryRouter>);
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders bike manufacturer', () => {
      renderWithRouter(<BikeOverviewCard {...defaultProps} />);

      expect(screen.getByText('Trek')).toBeInTheDocument();
    });

    it('renders bike name with year', () => {
      renderWithRouter(<BikeOverviewCard {...defaultProps} />);

      expect(screen.getByText('2024 Slash 9.8')).toBeInTheDocument();
    });

    it('renders bike name without year when null', () => {
      renderWithRouter(
        <BikeOverviewCard
          {...defaultProps}
          bike={createBike({ year: null })}
        />
      );

      expect(screen.getByText('Slash 9.8')).toBeInTheDocument();
    });

    it('renders nickname when present', () => {
      renderWithRouter(<BikeOverviewCard {...defaultProps} />);

      expect(screen.getByText('"Trail Slayer"')).toBeInTheDocument();
    });

    it('does not render nickname when null', () => {
      renderWithRouter(
        <BikeOverviewCard
          {...defaultProps}
          bike={createBike({ nickname: null })}
        />
      );

      expect(screen.queryByText(/".*"/)).not.toBeInTheDocument();
    });
  });

  describe('travel specs', () => {
    it('renders fork travel when present', () => {
      renderWithRouter(<BikeOverviewCard {...defaultProps} />);

      expect(screen.getByText('160mm')).toBeInTheDocument();
      expect(screen.getByText('front')).toBeInTheDocument();
    });

    it('renders shock travel when present', () => {
      renderWithRouter(<BikeOverviewCard {...defaultProps} />);

      expect(screen.getByText('150mm')).toBeInTheDocument();
      expect(screen.getByText('rear')).toBeInTheDocument();
    });

    it('does not render travel section when both null', () => {
      renderWithRouter(
        <BikeOverviewCard
          {...defaultProps}
          bike={createBike({ travelForkMm: null, travelShockMm: null })}
        />
      );

      expect(screen.queryByText('front')).not.toBeInTheDocument();
      expect(screen.queryByText('rear')).not.toBeInTheDocument();
    });
  });

  describe('badges', () => {
    it('renders subcategory badge when present', () => {
      renderWithRouter(<BikeOverviewCard {...defaultProps} />);

      expect(screen.getByText('Enduro')).toBeInTheDocument();
    });

    it('renders category badge when subcategory is null', () => {
      renderWithRouter(
        <BikeOverviewCard
          {...defaultProps}
          bike={createBike({ subcategory: null })}
        />
      );

      expect(screen.getByText('Mountain')).toBeInTheDocument();
    });

    it('renders e-bike badge when isEbike is true', () => {
      renderWithRouter(
        <BikeOverviewCard
          {...defaultProps}
          bike={createBike({ isEbike: true })}
        />
      );

      expect(screen.getByText('E-Bike')).toBeInTheDocument();
    });

    it('does not render e-bike badge when isEbike is false', () => {
      renderWithRouter(<BikeOverviewCard {...defaultProps} />);

      expect(screen.queryByText('E-Bike')).not.toBeInTheDocument();
    });

    it('renders frame material badge when present', () => {
      renderWithRouter(<BikeOverviewCard {...defaultProps} />);

      expect(screen.getByText('Carbon')).toBeInTheDocument();
    });
  });

  describe('component health', () => {
    it('renders component health section when components exist', () => {
      renderWithRouter(<BikeOverviewCard {...defaultProps} />);

      expect(screen.getByText('Component Health')).toBeInTheDocument();
    });

    it('does not render component health when no predictions', () => {
      renderWithRouter(
        <BikeOverviewCard
          {...defaultProps}
          bike={createBike({ predictions: null })}
        />
      );

      expect(screen.queryByText('Component Health')).not.toBeInTheDocument();
    });

    it('renders status dots for components', () => {
      renderWithRouter(<BikeOverviewCard {...defaultProps} />);

      expect(screen.getByTestId('status-dot-DUE_SOON')).toBeInTheDocument();
    });

    it('renders hours remaining for components', () => {
      renderWithRouter(<BikeOverviewCard {...defaultProps} />);

      expect(screen.getByText('10.5h')).toBeInTheDocument();
    });

    it('sorts components by urgency (most urgent first)', () => {
      const components = [
        createComponent({ componentId: '1', componentType: 'FORK', status: 'ALL_GOOD', hoursRemaining: 100 }),
        createComponent({ componentId: '2', componentType: 'SHOCK', status: 'OVERDUE', hoursRemaining: -5 }),
        createComponent({ componentId: '3', componentType: 'BRAKES', status: 'DUE_SOON', hoursRemaining: 10 }),
      ];

      renderWithRouter(
        <BikeOverviewCard
          {...defaultProps}
          bike={createBike({
            predictions: {
              bikeId: 'bike-1',
              bikeName: 'Test',
              components,
              priorityComponent: components[1],
              overallStatus: 'OVERDUE' as PredictionStatus,
              dueNowCount: 1,
              dueSoonCount: 1,
              generatedAt: new Date().toISOString(),
            },
          })}
        />
      );

      // OVERDUE should come first, then DUE_SOON, then ALL_GOOD
      const statusDots = screen.getAllByTestId(/status-dot-/);
      expect(statusDots[0]).toHaveAttribute('data-testid', 'status-dot-OVERDUE');
      expect(statusDots[1]).toHaveAttribute('data-testid', 'status-dot-DUE_SOON');
      expect(statusDots[2]).toHaveAttribute('data-testid', 'status-dot-ALL_GOOD');
    });

    it('renders component labels with location when present', () => {
      const components = [
        createComponent({ componentId: '1', componentType: 'BRAKES', location: 'FRONT' as ComponentLocation, status: 'DUE_SOON', hoursRemaining: 10 }),
        createComponent({ componentId: '2', componentType: 'BRAKES', location: 'REAR' as ComponentLocation, status: 'ALL_GOOD', hoursRemaining: 20 }),
      ];

      renderWithRouter(
        <BikeOverviewCard
          {...defaultProps}
          bike={createBike({
            predictions: {
              bikeId: 'bike-1',
              bikeName: 'Test',
              components,
              priorityComponent: components[0],
              overallStatus: 'DUE_SOON' as PredictionStatus,
              dueNowCount: 0,
              dueSoonCount: 1,
              generatedAt: new Date().toISOString(),
            },
          })}
        />
      );

      // Mock formatComponentLabel adds location in parentheses
      expect(screen.getByText('BRAKES (FRONT)')).toBeInTheDocument();
      expect(screen.getByText('BRAKES (REAR)')).toBeInTheDocument();
    });
  });

  describe('notes', () => {
    it('renders notes when present', () => {
      renderWithRouter(<BikeOverviewCard {...defaultProps} />);

      expect(screen.getByText(/My main enduro bike/)).toBeInTheDocument();
    });

    it('does not render notes when null', () => {
      renderWithRouter(
        <BikeOverviewCard
          {...defaultProps}
          bike={createBike({ notes: null })}
        />
      );

      expect(screen.queryByText('Notes:')).not.toBeInTheDocument();
    });
  });

  describe('actions', () => {
    it('renders Log service button when onLogService provided', () => {
      renderWithRouter(<BikeOverviewCard {...defaultProps} />);

      expect(screen.getByText('Log service')).toBeInTheDocument();
    });

    it('does not render Log service button when onLogService not provided', () => {
      renderWithRouter(
        <BikeOverviewCard {...defaultProps} onLogService={undefined} />
      );

      expect(screen.queryByText('Log service')).not.toBeInTheDocument();
    });

    it('calls onLogService when Log service clicked', () => {
      const onLogService = vi.fn();
      renderWithRouter(
        <BikeOverviewCard {...defaultProps} onLogService={onLogService} />
      );

      fireEvent.click(screen.getByText('Log service'));

      expect(onLogService).toHaveBeenCalledTimes(1);
    });

    it('renders Edit details link', () => {
      renderWithRouter(<BikeOverviewCard {...defaultProps} />);

      expect(screen.getByText('Edit details')).toBeInTheDocument();
    });

    it('Edit details links to correct path', () => {
      renderWithRouter(<BikeOverviewCard {...defaultProps} />);

      const link = screen.getByText('Edit details').closest('a');
      expect(link).toHaveAttribute('href', '/gear/bike-1');
    });

    it('renders 99spokes link when spokesUrl present', () => {
      renderWithRouter(<BikeOverviewCard {...defaultProps} />);

      expect(screen.getByText('99spokes')).toBeInTheDocument();
    });

    it('does not render 99spokes link when spokesUrl null', () => {
      renderWithRouter(
        <BikeOverviewCard
          {...defaultProps}
          bike={createBike({ spokesUrl: null })}
        />
      );

      expect(screen.queryByText('99spokes')).not.toBeInTheDocument();
    });

    it('99spokes link opens in new tab', () => {
      renderWithRouter(<BikeOverviewCard {...defaultProps} />);

      const link = screen.getByText('99spokes').closest('a');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('does not render 99spokes link for invalid domain', () => {
      renderWithRouter(
        <BikeOverviewCard
          {...defaultProps}
          bike={createBike({ spokesUrl: 'https://evil.com/phishing' })}
        />
      );

      expect(screen.queryByText('99spokes')).not.toBeInTheDocument();
    });

    it('does not render 99spokes link for malformed URL', () => {
      renderWithRouter(
        <BikeOverviewCard
          {...defaultProps}
          bike={createBike({ spokesUrl: 'not-a-valid-url' })}
        />
      );

      expect(screen.queryByText('99spokes')).not.toBeInTheDocument();
    });

    it('renders 99spokes link for subdomain', () => {
      renderWithRouter(
        <BikeOverviewCard
          {...defaultProps}
          bike={createBike({ spokesUrl: 'https://www.99spokes.com/bike/test' })}
        />
      );

      expect(screen.getByText('99spokes')).toBeInTheDocument();
    });
  });

  describe('kebab menu', () => {
    it('renders kebab menu with correct aria-label', () => {
      renderWithRouter(<BikeOverviewCard {...defaultProps} />);

      expect(screen.getByLabelText('Actions for 2024 Slash 9.8')).toBeInTheDocument();
    });

    it('calls onEdit when Edit bike clicked', () => {
      const onEdit = vi.fn();
      renderWithRouter(<BikeOverviewCard {...defaultProps} onEdit={onEdit} />);

      fireEvent.click(screen.getByTestId('kebab-edit-bike'));

      expect(onEdit).toHaveBeenCalledTimes(1);
    });

    it('calls onDelete when Delete bike clicked', () => {
      const onDelete = vi.fn();
      renderWithRouter(<BikeOverviewCard {...defaultProps} onDelete={onDelete} />);

      fireEvent.click(screen.getByTestId('kebab-delete-bike'));

      expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it('disables delete button when isDeleting is true', () => {
      renderWithRouter(<BikeOverviewCard {...defaultProps} isDeleting={true} />);

      const deleteButton = screen.getByTestId('kebab-deleting');
      expect(deleteButton).toBeDisabled();
      expect(deleteButton).toHaveTextContent('Deleting...');
    });

    it('does not call onDelete when isDeleting is true', () => {
      const onDelete = vi.fn();
      renderWithRouter(<BikeOverviewCard {...defaultProps} onDelete={onDelete} isDeleting={true} />);

      fireEvent.click(screen.getByTestId('kebab-deleting'));

      expect(onDelete).not.toHaveBeenCalled();
    });
  });

  describe('thumbnail', () => {
    it('renders image when thumbnailUrl present', () => {
      renderWithRouter(
        <BikeOverviewCard
          {...defaultProps}
          bike={createBike({ thumbnailUrl: 'https://example.com/bike.jpg' })}
        />
      );

      const img = screen.getByAltText('2024 Trek Slash 9.8');
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('src', 'https://example.com/bike.jpg');
    });

    it('shows placeholder when thumbnailUrl null', () => {
      renderWithRouter(<BikeOverviewCard {...defaultProps} />);

      const placeholder = document.querySelector('.bike-card-header-img-placeholder');
      expect(placeholder).toHaveStyle({ display: 'flex' });
    });
  });

  describe('formatHours utility', () => {
    it('formats hours with one decimal place', () => {
      const components = [
        createComponent({ hoursRemaining: 15.666 }),
      ];

      renderWithRouter(
        <BikeOverviewCard
          {...defaultProps}
          bike={createBike({
            predictions: {
              bikeId: 'bike-1',
              bikeName: 'Test',
              components,
              priorityComponent: components[0],
              overallStatus: 'DUE_SOON' as PredictionStatus,
              dueNowCount: 0,
              dueSoonCount: 1,
              generatedAt: new Date().toISOString(),
            },
          })}
        />
      );

      expect(screen.getByText('15.7h')).toBeInTheDocument();
    });

    it('shows dash for null hours', () => {
      const components = [
        createComponent({ hoursRemaining: null as unknown as number }),
      ];

      renderWithRouter(
        <BikeOverviewCard
          {...defaultProps}
          bike={createBike({
            predictions: {
              bikeId: 'bike-1',
              bikeName: 'Test',
              components,
              priorityComponent: components[0],
              overallStatus: 'ALL_GOOD' as PredictionStatus,
              dueNowCount: 0,
              dueSoonCount: 0,
              generatedAt: new Date().toISOString(),
            },
          })}
        />
      );

      expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('shows 0.0h for negative hours', () => {
      const components = [
        createComponent({ hoursRemaining: -5 }),
      ];

      renderWithRouter(
        <BikeOverviewCard
          {...defaultProps}
          bike={createBike({
            predictions: {
              bikeId: 'bike-1',
              bikeName: 'Test',
              components,
              priorityComponent: components[0],
              overallStatus: 'OVERDUE' as PredictionStatus,
              dueNowCount: 1,
              dueSoonCount: 0,
              generatedAt: new Date().toISOString(),
            },
          })}
        />
      );

      expect(screen.getByText('0.0h')).toBeInTheDocument();
    });
  });
});
