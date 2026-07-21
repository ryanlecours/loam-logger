import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComponentRidesModal } from './ComponentRidesModal';

// Dispatch mocked useQuery/useMutation by the raw gql document text (gql is
// mocked to return the template's first string).
const mockSetAdjustment = vi.fn().mockResolvedValue({});
const mockClearAdjustment = vi.fn().mockResolvedValue({});
const mockComponentRidesQuery = vi.fn();
const mockRidesQuery = vi.fn();

vi.mock('@apollo/client', () => ({
  gql: (strings: TemplateStringsArray) => strings.join(''),
  useQuery: (doc: string, opts: { skip?: boolean }) =>
    String(doc).includes('componentRides')
      ? mockComponentRidesQuery(doc, opts)
      : mockRidesQuery(doc, opts),
  useMutation: (doc: string) =>
    String(doc).includes('SetComponentRideAdjustment')
      ? [mockSetAdjustment, { loading: false }]
      : [mockClearAdjustment, { loading: false }],
}));

vi.mock('../ui/Modal', () => ({
  Modal: ({ isOpen, title, children }: { isOpen: boolean; title: string; children: React.ReactNode }) =>
    isOpen ? (
      <div data-testid="modal">
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
}));

vi.mock('../ui/Button', () => ({
  Button: ({ children, onClick, disabled }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

const entry = (
  id: string,
  over: Partial<{ counted: boolean; adjustment: 'EXCLUDE' | 'INCLUDE' | null; beforeAnchor: boolean; bikeId: string | null }> = {}
) => ({
  counted: over.counted ?? true,
  adjustment: over.adjustment ?? null,
  beforeAnchor: over.beforeAnchor ?? false,
  ride: {
    id,
    startTime: '2026-06-15T00:00:00.000Z',
    durationSeconds: 3600,
    distanceMeters: 10000,
    location: `Trail ${id}`,
    trailSystem: null,
    rideType: 'TRAIL',
    bikeId: over.bikeId === undefined ? 'bike-1' : over.bikeId,
  },
});

const basePayload = {
  componentRides: {
    componentId: 'comp-1',
    anchor: '2026-06-01T00:00:00.000Z',
    countedHours: 2,
    hoursUsed: 2,
    countedRideCount: 2,
    hasMore: false,
    entries: [
      entry('r-normal'),
      entry('r-excluded', { counted: false, adjustment: 'EXCLUDE' }),
      entry('r-included', { adjustment: 'INCLUDE', bikeId: 'bike-2' }),
    ],
  },
};

const renderModal = () =>
  render(
    <ComponentRidesModal
      componentId="comp-1"
      componentLabel="Fox 36"
      bikeId="bike-1"
      onClose={() => {}}
    />
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockComponentRidesQuery.mockReturnValue({
    data: basePayload,
    loading: false,
    fetchMore: vi.fn(),
    refetch: vi.fn(),
  });
  mockRidesQuery.mockReturnValue({ data: { rides: [] }, loading: false });
});

describe('ComponentRidesModal', () => {
  it('renders totals and the anchor window', () => {
    renderModal();
    expect(screen.getByText('2.0h')).toBeInTheDocument();
    expect(screen.getByText(/from 2 rides/)).toBeInTheDocument();
    expect(screen.getByText(/since service on/)).toBeInTheDocument();
  });

  it('shows the recalculation hint only when stored hours drifted', () => {
    const { rerender } = renderModal();
    expect(screen.queryByText(/will be recalculated/)).not.toBeInTheDocument();

    mockComponentRidesQuery.mockReturnValue({
      data: {
        componentRides: { ...basePayload.componentRides, hoursUsed: 5.5 },
      },
      loading: false,
      fetchMore: vi.fn(),
      refetch: vi.fn(),
    });
    rerender(
      <ComponentRidesModal componentId="comp-1" componentLabel="Fox 36" bikeId="bike-1" onClose={() => {}} />
    );
    expect(screen.getByText(/will be recalculated/)).toBeInTheDocument();
  });

  it('marks excluded and cross-bike-included rides', () => {
    renderModal();
    expect(screen.getByTestId('component-ride-r-excluded')).toHaveTextContent('Restore');
    expect(screen.getByTestId('component-ride-r-included')).toHaveTextContent(
      'applied from another bike'
    );
  });

  it('flags dormant pre-anchor INCLUDEs instead of silently ignoring them', () => {
    mockComponentRidesQuery.mockReturnValue({
      data: {
        componentRides: {
          ...basePayload.componentRides,
          entries: [entry('r-dormant', { counted: false, adjustment: 'INCLUDE', beforeAnchor: true, bikeId: 'bike-2' })],
        },
      },
      loading: false,
      fetchMore: vi.fn(),
      refetch: vi.fn(),
    });
    renderModal();
    expect(screen.getByText(/predates last service/)).toBeInTheDocument();
  });

  it('Remove on a default ride sets an EXCLUDE adjustment', () => {
    renderModal();
    const row = screen.getByTestId('component-ride-r-normal');
    fireEvent.click(row.querySelector('button')!);

    expect(mockSetAdjustment).toHaveBeenCalledWith({
      variables: { componentId: 'comp-1', rideId: 'r-normal', kind: 'EXCLUDE' },
    });
  });

  it('Restore on an excluded ride clears the adjustment', () => {
    renderModal();
    const row = screen.getByTestId('component-ride-r-excluded');
    fireEvent.click(row.querySelector('button')!);

    expect(mockClearAdjustment).toHaveBeenCalledWith({
      variables: { componentId: 'comp-1', rideId: 'r-excluded' },
    });
  });

  it('keeps an in-flight row disabled when another row is clicked (no double-submit)', () => {
    mockComponentRidesQuery.mockReturnValue({
      data: {
        componentRides: {
          ...basePayload.componentRides,
          entries: [entry('r-a'), entry('r-b')],
        },
      },
      loading: false,
      fetchMore: vi.fn(),
      refetch: vi.fn(),
    });
    // Never resolves — both mutations stay in flight for the whole test.
    mockSetAdjustment.mockReturnValue(new Promise(() => {}));

    renderModal();
    const btnA = () => screen.getByTestId('component-ride-r-a').querySelector('button')!;
    const btnB = () => screen.getByTestId('component-ride-r-b').querySelector('button')!;

    fireEvent.click(btnA());
    expect(btnA()).toBeDisabled();

    // Clicking B must NOT re-enable A (a single pendingRideId would flip to B
    // and re-open A to a second, concurrent submit).
    fireEvent.click(btnB());
    expect(btnA()).toBeDisabled();
    expect(btnB()).toBeDisabled();

    // Attempted double-submit on the still-pending A — disabled, so a no-op.
    fireEvent.click(btnA());
    const aSubmits = mockSetAdjustment.mock.calls.filter(
      (call) => call[0]?.variables?.rideId === 'r-a'
    );
    expect(aSubmits).toHaveLength(1);
  });

  it('Add tab lists only unadjusted rides from other bikes and applies INCLUDE', () => {
    mockRidesQuery.mockReturnValue({
      data: {
        rides: [
          { id: 'r-other', startTime: '2026-06-20T00:00:00.000Z', durationSeconds: 1800, bikeId: 'bike-2', location: 'Other trail' },
          { id: 'r-own-bike', startTime: '2026-06-20T00:00:00.000Z', durationSeconds: 1800, bikeId: 'bike-1', location: 'Same bike' },
          { id: 'r-included', startTime: '2026-06-20T00:00:00.000Z', durationSeconds: 1800, bikeId: 'bike-2', location: 'Already applied' },
        ],
      },
      loading: false,
    });
    renderModal();
    fireEvent.click(screen.getByText('Add rides'));

    // Own-bike and already-adjusted rides are filtered out.
    expect(screen.getByTestId('component-ride-add-r-other')).toBeInTheDocument();
    expect(screen.queryByTestId('component-ride-add-r-own-bike')).not.toBeInTheDocument();
    expect(screen.queryByTestId('component-ride-add-r-included')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Apply'));
    expect(mockSetAdjustment).toHaveBeenCalledWith({
      variables: { componentId: 'comp-1', rideId: 'r-other', kind: 'INCLUDE' },
    });
  });

  it('Add tab advertises the window and loads older rides via cursor when a full page came back', () => {
    // Exactly one full page (300) -> older rides may exist beyond the window.
    const fullPage = Array.from({ length: 300 }, (_, i) => ({
      id: `r-${i}`,
      startTime: '2026-06-20T00:00:00.000Z',
      durationSeconds: 1800,
      bikeId: 'bike-2',
      location: `Trail ${i}`,
    }));
    const mockFetchMoreRides = vi.fn();
    mockRidesQuery.mockReturnValue({
      data: { rides: fullPage },
      loading: false,
      fetchMore: mockFetchMoreRides,
    });
    renderModal();
    fireEvent.click(screen.getByText('Add rides'));

    expect(screen.getByText(/Showing your 300 most recent rides/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Load older rides'));
    expect(mockFetchMoreRides).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({ after: 'r-299', take: 300 }),
      })
    );
  });

  it('Add tab lists unassigned rides for a SPARE component (null !== null trap)', () => {
    // Regression: nullish equality made spare component (bikeId null) +
    // unassigned ride (bikeId null) compare "same bike", hiding exactly the
    // rides most relevant to apply to a spare. The backend allows this
    // INCLUDE; the tab must offer it.
    mockRidesQuery.mockReturnValue({
      data: {
        rides: [
          { id: 'r-unassigned', startTime: '2026-06-20T00:00:00.000Z', durationSeconds: 1800, bikeId: null, location: 'Somewhere' },
          { id: 'r-on-a-bike', startTime: '2026-06-21T00:00:00.000Z', durationSeconds: 1800, bikeId: 'bike-9', location: 'Elsewhere' },
        ],
      },
      loading: false,
      fetchMore: vi.fn(),
    });
    render(
      <ComponentRidesModal
        componentId="comp-spare"
        componentLabel="Spare wheel"
        bikeId={null}
        onClose={() => {}}
      />
    );
    fireEvent.click(screen.getByText('Add rides'));

    // Both the unassigned ride AND rides on any bike are valid candidates
    // for a spare component.
    expect(screen.getByTestId('component-ride-add-r-unassigned')).toBeInTheDocument();
    expect(screen.getByTestId('component-ride-add-r-on-a-bike')).toBeInTheDocument();
  });

  it('Add tab date range is passed to the server as a rides filter', () => {
    renderModal();
    fireEvent.click(screen.getByText('Add rides'));

    fireEvent.change(screen.getByLabelText('Rides from date'), {
      target: { value: '2026-06-01' },
    });
    fireEvent.change(screen.getByLabelText('Rides to date'), {
      target: { value: '2026-06-30' },
    });

    const lastCall = mockRidesQuery.mock.calls[mockRidesQuery.mock.calls.length - 1];
    expect(lastCall[1].variables.filter).toEqual({
      startDate: new Date('2026-06-01T00:00:00').toISOString(),
      endDate: new Date('2026-06-30T23:59:59.999').toISOString(),
    });
  });

  it('Add tab search filters loaded rides client-side', () => {
    mockRidesQuery.mockReturnValue({
      data: {
        rides: [
          { id: 'r-galby', startTime: '2026-06-20T00:00:00.000Z', durationSeconds: 1800, bikeId: 'bike-2', location: 'Galbraith' },
          { id: 'r-chuck', startTime: '2026-06-21T00:00:00.000Z', durationSeconds: 1800, bikeId: 'bike-2', location: 'Chuckanut' },
        ],
      },
      loading: false,
      fetchMore: vi.fn(),
    });
    renderModal();
    fireEvent.click(screen.getByText('Add rides'));

    fireEvent.change(screen.getByLabelText('Search rides'), {
      target: { value: 'galb' },
    });

    expect(screen.getByTestId('component-ride-add-r-galby')).toBeInTheDocument();
    expect(screen.queryByTestId('component-ride-add-r-chuck')).not.toBeInTheDocument();
  });

  it('Add tab shows no truncation UI when the first page came back short', () => {
    mockRidesQuery.mockReturnValue({
      data: {
        rides: [
          { id: 'r-only', startTime: '2026-06-20T00:00:00.000Z', durationSeconds: 1800, bikeId: 'bike-2', location: 'Trail' },
        ],
      },
      loading: false,
      fetchMore: vi.fn(),
    });
    renderModal();
    fireEvent.click(screen.getByText('Add rides'));

    expect(screen.queryByText(/most recent rides/)).not.toBeInTheDocument();
    expect(screen.queryByText('Load older rides')).not.toBeInTheDocument();
  });
});
