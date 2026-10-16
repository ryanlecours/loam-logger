import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import ComponentHistory from './ComponentHistory';

const mockUseQuery = vi.fn();
vi.mock('@apollo/client', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  gql: vi.fn((strings: TemplateStringsArray) => strings[0]),
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useParams: () => ({ componentId: 'comp-1' }) };
});

vi.mock('@/hooks/usePreferences', () => ({
  usePreferences: () => ({ distanceUnit: 'mi' }),
}));

const mockIsPro = vi.fn(() => true);
vi.mock('@/hooks/useUserTier', () => ({
  useUserTier: () => ({ isPro: mockIsPro() }),
}));

vi.mock('@/constants/componentLabels', () => ({
  getComponentLabel: (t: string) => (t === 'FORK' ? 'Fork' : t),
}));

vi.mock('@/components/attribution/GarminAttribution', () => ({
  GarminDerivedNote: () => <div data-testid="garmin-note" />,
}));

vi.mock('@/components/UpgradePrompt', () => ({
  ProChip: () => <span data-testid="pro-chip">Pro</span>,
}));

// The share panel has its own tests; here it only has to show up with the
// component's first install as the earliest shareable date.
vi.mock('@/components/history/ComponentSharePanel', () => ({
  ComponentSharePanel: ({ installedAt }: { installedAt: string }) => (
    <div data-testid="share-panel" data-installed-at={installedAt} />
  ),
}));

// recharts renders nothing useful in jsdom (no layout), so the charts are
// stubbed down to probes that assert what was handed to them.
vi.mock('recharts', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Pass,
    AreaChart: ({ data, children }: { data: unknown[]; children?: React.ReactNode }) => (
      <div data-testid="wear-chart" data-points={data.length}>
        {children}
      </div>
    ),
    BarChart: ({ data, children }: { data: unknown[]; children?: React.ReactNode }) => (
      <div data-testid="conditions-chart" data-bars={data.length}>
        {children}
      </div>
    ),
    Area: () => null,
    Bar: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Cell: () => null,
    CartesianGrid: () => null,
    LabelList: () => null,
    ReferenceLine: ({ x }: { x: string }) => <div data-testid="service-mark" data-x={x} />,
    Tooltip: () => null,
    XAxis: () => null,
    YAxis: () => null,
  };
});

const BASE = {
  anchor: '2025-06-01T00:00:00.000Z',
  coverage: 'FULL',
  historyIncomplete: false,
  driftDetected: false,
  component: {
    id: 'comp-1',
    type: 'FORK',
    location: 'NONE',
    brand: 'Fox',
    model: '36 Factory',
    notes: null,
    isStock: false,
    bikeId: 'bike-1',
    status: 'INSTALLED',
    hoursUsed: 40,
    serviceDueAtHours: 100,
    // Stored, ledger-backed counters. Hours on the page come from these, not
    // from the ride-summed tenure totals, because they include declared
    // pre-Loam hours which no ride data can reconstruct.
    priorHours: 0,
    lifetimeHours: 312,
    hoursSinceService: 40,
    lastInspectedAt: null,
    installedAt: '2024-01-01T00:00:00.000Z',
    lastServicedAt: '2025-06-01T00:00:00.000Z',
    retiredAt: null,
    replacedById: null,
  },
  lifetime: {
    rideCount: 96,
    durationSeconds: 1123200, // 312h
    distanceMeters: 2972000,
    elevationGainMeters: 86840,
    firstRideAt: '2024-01-15T00:00:00.000Z',
    lastRideAt: '2026-08-01T00:00:00.000Z',
  },
  sinceService: {
    rideCount: 12,
    durationSeconds: 144000, // 40h
    distanceMeters: 381000,
    elevationGainMeters: 11200,
    firstRideAt: '2025-06-03T00:00:00.000Z',
    lastRideAt: '2026-08-01T00:00:00.000Z',
  },
  tenures: [
    {
      id: 't1',
      slotKey: 'FORK_NONE',
      installedAt: '2024-01-01T00:00:00.000Z',
      removedAt: '2025-03-01T00:00:00.000Z',
      synthetic: false,
      bike: {
        id: 'bike-0',
        nickname: 'Old Hardtail',
        manufacturer: 'Kona',
        model: 'Honzo',
        year: 2019,
        thumbnailUrl: null,
      },
      totals: {
        rideCount: 50,
        durationSeconds: 540000,
        distanceMeters: 1500000,
        elevationGainMeters: 40000,
      },
    },
    {
      id: 't2',
      slotKey: 'FORK_NONE',
      installedAt: '2025-03-01T00:00:00.000Z',
      removedAt: null,
      synthetic: false,
      bike: {
        id: 'bike-1',
        nickname: 'Ripmo',
        manufacturer: 'Ibis',
        model: 'Ripmo',
        year: 2023,
        thumbnailUrl: null,
      },
      totals: {
        rideCount: 46,
        durationSeconds: 583200,
        distanceMeters: 1472000,
        elevationGainMeters: 46840,
      },
    },
  ],
  serviceEvents: [
    { id: 's1', performedAt: '2025-06-01T00:00:00.000Z', notes: 'Lower leg service', kind: 'SERVICE', hoursAtService: 272 },
    { id: 'i1', performedAt: '2025-08-01T00:00:00.000Z', notes: 'Bushings fine', kind: 'INSPECTION', hoursAtService: 290, serviceExtensionHours: 25 },
  ],
  conditions: [
    { condition: 'SUNNY', rideCount: 31, durationSeconds: 352800 },
    { condition: 'CLOUDY', rideCount: 44, durationSeconds: 507600 },
    { condition: 'RAINY', rideCount: 14, durationSeconds: 169200 },
    { condition: 'SNOWY', rideCount: 0, durationSeconds: 0 },
    { condition: 'WINDY', rideCount: 0, durationSeconds: 0 },
    { condition: 'FOGGY', rideCount: 5, durationSeconds: 68400 },
    { condition: 'UNKNOWN', rideCount: 2, durationSeconds: 25200 },
  ],
  cumulative: [
    { date: '2024-01-01T00:00:00.000Z', cumulativeHours: 20, cumulativeDistanceMeters: 1, cumulativeElevationGainMeters: 1 },
    { date: '2024-02-01T00:00:00.000Z', cumulativeHours: 55, cumulativeDistanceMeters: 2, cumulativeElevationGainMeters: 2 },
    { date: '2024-03-01T00:00:00.000Z', cumulativeHours: 91, cumulativeDistanceMeters: 3, cumulativeElevationGainMeters: 3 },
  ],
};

// Newest first, as the API pages them: one on each bike the fork has lived on.
const RIDES = [
  {
    id: 'r2', startTime: '2026-08-01T16:00:00.000Z', durationSeconds: 5400,
    distanceMeters: 16093, elevationGainMeters: 610, trailSystem: 'Galbraith', location: 'Bellingham, WA',
    bikeId: 'bike-1', garminActivityId: 'g-2', garminDeviceName: 'edge_840',
  },
  {
    id: 'r1', startTime: '2025-01-10T16:00:00.000Z', durationSeconds: 3000,
    distanceMeters: 8047, elevationGainMeters: 300, trailSystem: null, location: null,
    bikeId: 'bike-0', stravaActivityId: 's-1',
  },
];

const mockFetchMore = vi.fn();
let historyResult: unknown;
let ridesResult: unknown;

const setPayload = (over: Record<string, unknown> = {}) => {
  historyResult = {
    data: { componentHistory: { ...BASE, ...over } },
    loading: false,
    error: undefined,
  };
};

const setRides = (rides: unknown[] = RIDES, hasMore = false) => {
  ridesResult = {
    data: { componentHistoryRides: { rides, hasMore } },
    loading: false,
    error: undefined,
    fetchMore: mockFetchMore,
  };
};

// The page runs two queries: the aggregate history and its ride rows.
const ridesCalls = () =>
  mockUseQuery.mock.calls.filter(([doc]) => String(doc).includes('componentHistoryRides'));

const renderPage = () =>
  render(
    <MemoryRouter>
      <ComponentHistory />
    </MemoryRouter>
  );

describe('ComponentHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsPro.mockReturnValue(true);
    setPayload();
    setRides();
    mockUseQuery.mockImplementation((doc: unknown) =>
      String(doc).includes('componentHistoryRides') ? ridesResult : historyResult
    );
  });

  it('shows the component identity and where it currently lives', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Fox 36 Factory Fork/i })).toBeInTheDocument();
    expect(screen.getByText(/On Ripmo since/i)).toBeInTheDocument();
  });

  it('defaults to lifetime totals, not since-service', () => {
    renderPage();
    // 312 lifetime hours from the stored counter. The app elsewhere only ever
    // shows the 40h since-service figure.
    expect(screen.getByText('312h 0m')).toBeInTheDocument();
    expect(screen.getByText('96')).toBeInTheDocument();
  });

  it('switches to the since-service window with its own distance and elevation', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Since last service' }));

    expect(screen.getByText('40h 0m')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    // The window is now totalled from the same tenure-bounded rides as the
    // lifetime tab, so distance and elevation are real figures, not dashes.
    expect(screen.queryAllByText('—')).toHaveLength(0);
    expect(screen.getByText(/counting from the last service on/i)).toBeInTheDocument();
    expect(screen.queryByText(/only totalled over/i)).not.toBeInTheDocument();
  });

  it('lists every bike the component has lived on with per-tenure totals', () => {
    renderPage();
    expect(screen.getByText('Old Hardtail')).toBeInTheDocument();
    expect(screen.getByText('Ripmo')).toBeInTheDocument();
    expect(screen.getByText(/50 rides/)).toBeInTheDocument();
    expect(screen.getByText(/46 rides/)).toBeInTheDocument();
  });

  it('states that conditions do not drive service intervals', () => {
    renderPage();
    expect(
      screen.getByText(/Conditions are not currently factored into service intervals/i)
    ).toBeInTheDocument();
  });

  it('charts only the conditions that actually occurred', () => {
    renderPage();
    // Five of seven buckets are non-zero; empty ones must not become bars.
    expect(screen.getByTestId('conditions-chart')).toHaveAttribute('data-bars', '5');
  });

  it('gates conditions behind Pro without claiming they affect wear', () => {
    mockIsPro.mockReturnValue(false);
    renderPage();

    expect(screen.getByTestId('pro-chip')).toBeInTheDocument();
    expect(screen.queryByTestId('conditions-chart')).not.toBeInTheDocument();
    // The stock weather upsell copy claims conditions feed service estimates,
    // which is false today — it must not appear next to the note above.
    expect(screen.queryByText(/your service estimates know it/i)).not.toBeInTheDocument();
  });

  it('distinguishes inspections from services in the logbook', () => {
    renderPage();
    expect(screen.getByText('Lower leg service')).toBeInTheDocument();
    expect(screen.getByText('Bushings fine')).toBeInTheDocument();
    // An inspection is a check, not work. The logbook has to be able to say so,
    // and the old model had no way to.
    expect(screen.getByText(/Inspected/)).toBeInTheDocument();
    expect(screen.getByText(/Serviced/)).toBeInTheDocument();
  });

  it('shows a lifetime figure larger than the since-service one', () => {
    renderPage();
    // The whole point: 312 lifetime hours vs 40 since service. hoursAtService is
    // now a lifetime reading too, so 272h reads as "serviced at 272 hours".
    expect(screen.getByText('312h 0m')).toBeInTheDocument();
    expect(screen.getByText('at 272h')).toBeInTheDocument();
  });

  it('states declared pre-Loam hours instead of folding them in silently', () => {
    setPayload({ component: { ...BASE.component, priorHours: 200, lifetimeHours: 512 } });
    renderPage();
    expect(screen.getByText(/200h declared before this component was tracked/i)).toBeInTheDocument();
  });

  // An inspection stood in for a due service, so its logbook entry says how
  // much riding it granted before the next one.
  it('shows the extension an inspection granted', () => {
    renderPage();
    expect(screen.getByText(/Inspected, good for 25h more/)).toBeInTheDocument();
  });

  it('marks only service dates on the wear chart, not inspections', () => {
    renderPage();
    expect(screen.getByTestId('wear-chart')).toHaveAttribute('data-points', '3');
    // Two log entries, one of which is an inspection: it moved the due point,
    // but no work was done on the part.
    expect(screen.getAllByTestId('service-mark')).toHaveLength(1);
  });

  it('warns when install history is incomplete', () => {
    setPayload({ historyIncomplete: true });
    renderPage();
    expect(screen.getByText(/install history is missing/i)).toBeInTheDocument();
  });

  it('says every ride counts when no service is logged', () => {
    setPayload({ anchor: null });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Since last service' }));

    expect(screen.getByText(/no service logged yet/i)).toBeInTheDocument();
  });

  it('explains an inventory component instead of showing zeros', () => {
    setPayload({
      coverage: 'NO_TENURE_DATA',
      tenures: [],
      component: { ...BASE.component, bikeId: null, status: 'INVENTORY' },
    });
    renderPage();

    expect(screen.getByText(/In inventory/)).toBeInTheDocument();
    expect(screen.getByText(/no recorded time on a bike yet/i)).toBeInTheDocument();
    // Zeros would read as "ridden nothing" rather than "nothing to attribute".
    expect(screen.queryByText('Lifetime')).not.toBeInTheDocument();
  });

  it('names contributing sources above the fold', () => {
    renderPage();
    expect(screen.getByTestId('garmin-note')).toBeInTheDocument();
  });

  // A shared date range may start no earlier than the part's first install.
  it('offers sharing from the first install on', () => {
    renderPage();
    expect(screen.getByTestId('share-panel')).toHaveAttribute('data-installed-at', '2024-01-01T00:00:00.000Z');
  });

  it('has nothing to share for a part that has never been on a bike', () => {
    setPayload({
      coverage: 'NO_TENURE_DATA',
      tenures: [],
      component: { ...BASE.component, bikeId: null, status: 'INVENTORY' },
    });
    renderPage();
    expect(screen.queryByTestId('share-panel')).not.toBeInTheDocument();
  });

  // The rows behind the totals, so a rider can see what each ride was.
  it('lists each counted ride, attributed and named by its bike', () => {
    renderPage();
    const list = screen.getByRole('heading', { name: 'Rides' }).closest('section')!;

    expect(within(list).getByText('Galbraith')).toBeInTheDocument();
    // Garmin's device-model attribution sits on the row itself.
    expect(within(list).getByText('Garmin Edge 840')).toBeInTheDocument();
    expect(within(list).getByText(/Bellingham, WA · Ripmo/)).toBeInTheDocument();
    expect(within(list).getByText('1h 30m')).toBeInTheDocument();
    // No trail or location: the same fallback title the rides list uses.
    expect(within(list).getByText('Ride')).toBeInTheDocument();
    expect(within(list).getByText(/Old Hardtail/)).toBeInTheDocument();
  });

  it('leaves the bike off each row when the part has only lived on one', () => {
    setPayload({ tenures: [BASE.tenures[1]] });
    renderPage();
    const list = screen.getByRole('heading', { name: 'Rides' }).closest('section')!;
    expect(within(list).queryByText(/Ripmo/)).not.toBeInTheDocument();
  });

  it('asks for every ride by default and for rides since service after the toggle', () => {
    renderPage();
    expect(ridesCalls().at(-1)![1].variables).toMatchObject({ componentId: 'comp-1', sinceService: false, offset: 0 });

    fireEvent.click(screen.getByRole('button', { name: 'Since last service' }));
    expect(ridesCalls().at(-1)![1].variables).toMatchObject({ sinceService: true, offset: 0 });
    expect(screen.getByText(/every ride since the last service/i)).toBeInTheDocument();
  });

  it('pages on from where the list ends', () => {
    setRides(RIDES, true);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Show more rides' }));
    expect(mockFetchMore).toHaveBeenCalledWith(expect.objectContaining({ variables: { offset: 2 } }));
  });

  // A ride synced between pages shifts the offset window, so the next page
  // can repeat a row; the merge drops it rather than listing a ride twice.
  it('merges a new page without repeating a ride already listed', async () => {
    setRides(RIDES, true);
    mockFetchMore.mockResolvedValue({});
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Show more rides' }));

    const { updateQuery } = mockFetchMore.mock.calls[0][0];
    const prev = { componentHistoryRides: { rides: RIDES, hasMore: true } };
    const next = { componentHistoryRides: { rides: [RIDES[1], { ...RIDES[1], id: 'r0' }], hasMore: false } };
    const merged = updateQuery(prev, { fetchMoreResult: next });

    expect(merged.componentHistoryRides.rides.map((r: { id: string }) => r.id)).toEqual(['r2', 'r1', 'r0']);
    expect(merged.componentHistoryRides.hasMore).toBe(false);
  });

  it('says so when there are no rides yet', () => {
    setRides([]);
    renderPage();
    expect(screen.getByText('No rides recorded yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more rides' })).not.toBeInTheDocument();
  });
});
