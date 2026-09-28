import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
  consistencyWarning: false,
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
    hoursSinceInspection: 12,
    inspectionDueAtHours: null,
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
  sinceService: { rideCount: 12, durationSeconds: 144000 }, // 40h
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
    { id: 'i1', performedAt: '2025-08-01T00:00:00.000Z', notes: 'Bushings fine', kind: 'INSPECTION', hoursAtService: 290 },
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

const setPayload = (over: Record<string, unknown> = {}) => {
  mockUseQuery.mockReturnValue({
    data: { componentHistory: { ...BASE, ...over } },
    loading: false,
    error: undefined,
  });
};

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

  it('switches to the since-service window and hides distance and elevation', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Since last service' }));

    expect(screen.getByText('40h 0m')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    // Distance/elevation have no canonical since-service counterpart, so they
    // must read as unavailable rather than as zero.
    expect(screen.getAllByText('—')).toHaveLength(2);
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

  it('shows the inspection clock only when the type is inspection-tracked', () => {
    renderPage();
    expect(screen.queryByText(/Inspection:/)).not.toBeInTheDocument();

    setPayload({
      component: { ...BASE.component, inspectionDueAtHours: 50, hoursSinceInspection: 12 },
    });
    renderPage();
    // Absent is a different statement from "inspection is fine", so a
    // non-inspectable part must render no inspection line at all.
    expect(screen.getByText(/12h since last check, every 50h/i)).toBeInTheDocument();
  });

  it('marks only service dates on the wear chart, not inspections', () => {
    renderPage();
    expect(screen.getByTestId('wear-chart')).toHaveAttribute('data-points', '3');
    // Two log entries, one of which is an inspection: an inspection resets the
    // inspection clock without changing the service interval the chart shows.
    expect(screen.getAllByTestId('service-mark')).toHaveLength(1);
  });

  it('warns when install history is incomplete', () => {
    setPayload({ historyIncomplete: true });
    renderPage();
    expect(screen.getByText(/install history is missing/i)).toBeInTheDocument();
  });

  it('warns when since-service hours exceed lifetime', () => {
    setPayload({ consistencyWarning: true });
    renderPage();
    expect(screen.getByText(/exceed its recorded lifetime/i)).toBeInTheDocument();
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
});
