import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import SharedComponentHistory from './SharedComponentHistory';

const mockUseQuery = vi.fn();
vi.mock('@apollo/client', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  gql: vi.fn((strings: TemplateStringsArray) => strings.join('')),
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useParams: () => ({ slug: 'abcdefghijkl' }) };
});

vi.mock('@/constants/componentLabels', () => ({
  getComponentLabel: (t: string) => (t === 'WHEEL_HUBS' ? 'Wheel Hubs' : t),
}));

vi.mock('@/components/attribution/GarminAttribution', () => ({
  GarminDerivedNote: () => <div data-testid="garmin-note" />,
  GarminTrademarkNotice: () => <div data-testid="garmin-tm" />,
}));

vi.mock('@/components/history/WearChart', () => ({
  WearChart: ({ points, serviceDates }: { points: unknown[]; serviceDates: string[] }) => (
    <div data-testid="wear-chart" data-points={points.length} data-marks={serviceDates.length} />
  ),
}));

const PAYLOAD = {
  component: { type: 'WHEEL_HUBS', location: 'NONE', brand: 'Project321', model: 'G3', isStock: true },
  scope: 'SINCE_SERVICE',
  windowStart: '2026-08-01T12:00:00.000Z',
  windowEnd: null,
  totals: {
    rideCount: 12,
    durationSeconds: 40 * 3600,
    distanceMeters: 180000,
    elevationGainMeters: 9000,
    firstRideAt: '2026-08-02T10:00:00.000Z',
    lastRideAt: '2026-10-06T10:00:00.000Z',
  },
  declaredPriorHours: 0,
  bikes: [
    {
      bike: { manufacturer: 'Propain', model: 'TYEE 6 CF', year: 2025, thumbnailUrl: null },
      installedAt: '2025-09-15T16:00:00.000Z',
      removedAt: null,
      totals: { rideCount: 12, durationSeconds: 40 * 3600, distanceMeters: 180000 },
    },
  ],
  logbook: [
    { performedAt: '2026-09-01T12:00:00.000Z', kind: 'INSPECTION', hoursAtService: 170, serviceExtensionHours: 30 },
    { performedAt: '2026-08-01T12:00:00.000Z', kind: 'SERVICE', hoursAtService: 140, serviceExtensionHours: null },
  ],
  cumulative: [
    { date: '2026-08-01T00:00:00.000Z', cumulativeHours: 15 },
    { date: '2026-09-01T00:00:00.000Z', cumulativeHours: 30 },
    { date: '2026-10-01T00:00:00.000Z', cumulativeHours: 40 },
  ],
  contributingSources: ['garmin'],
};

const RIDES = [
  {
    date: '2026-10-06', durationSeconds: 5400, distanceMeters: 16093, elevationGainMeters: 610,
    trailSystem: 'Galbraith', location: 'Bellingham, WA', sources: ['strava', 'garmin'],
    garminAttribution: 'Garmin Edge 840',
  },
  {
    date: '2026-10-01', durationSeconds: 3000, distanceMeters: 8047, elevationGainMeters: 300,
    trailSystem: null, location: null, sources: [], garminAttribution: null,
  },
];

const mockFetchMore = vi.fn();
const ridesCalls = () =>
  mockUseQuery.mock.calls.filter(([doc]) => String(doc).includes('sharedComponentRides'));

const renderPage = (payload: unknown, ridePage: unknown = { rides: RIDES, hasMore: false }) => {
  mockUseQuery.mockImplementation((doc: unknown) =>
    String(doc).includes('sharedComponentRides')
      ? { data: { sharedComponentRides: ridePage }, loading: false, error: undefined, fetchMore: mockFetchMore }
      : { data: { sharedComponentHistory: payload }, loading: false, error: undefined }
  );
  return render(
    <MemoryRouter>
      <SharedComponentHistory />
    </MemoryRouter>
  );
};

describe('SharedComponentHistory', () => {
  beforeEach(() => {
    mockUseQuery.mockReset();
    mockFetchMore.mockReset();
  });

  it('shows the window the link was made for, with its totals', () => {
    renderPage(PAYLOAD);

    expect(screen.getByText('Project321 G3 Wheel Hubs')).toBeInTheDocument();
    expect(screen.getByText(/Since its last service on/)).toBeInTheDocument();
    expect(screen.getByText('Hours').parentElement).toHaveTextContent('40h 0m');
    expect(screen.getByText('Rides').parentElement).toHaveTextContent('12');
  });

  it('draws the wear chart with only service dates marked', () => {
    renderPage(PAYLOAD);
    const chart = screen.getByTestId('wear-chart');
    expect(chart).toHaveAttribute('data-points', '3');
    expect(chart).toHaveAttribute('data-marks', '1');
  });

  it('names bikes by make and model, and lists the logbook', () => {
    renderPage(PAYLOAD);
    expect(screen.getByText('2025 Propain TYEE 6 CF')).toBeInTheDocument();
    expect(screen.getByText('Inspected, good for 30h more')).toBeInTheDocument();
    expect(screen.getByText('Serviced')).toBeInTheDocument();
  });

  it('labels a range link by its days, counting the end day', () => {
    renderPage({
      ...PAYLOAD,
      scope: 'RANGE',
      windowStart: new Date('2026-01-01T00:00:00').toISOString(),
      windowEnd: new Date('2026-02-01T00:00:00').toISOString(),
    });
    expect(screen.getByText(/Jan 31, 2026/)).toBeInTheDocument();
  });

  it('carries the Garmin attribution when Garmin rides contribute', () => {
    renderPage(PAYLOAD);
    expect(screen.getByTestId('garmin-note')).toBeInTheDocument();

    renderPage({ ...PAYLOAD, contributingSources: ['strava'] });
    expect(screen.getAllByTestId('garmin-note')).toHaveLength(1);
  });

  it('fetches without cookies, so a signed-in viewer is not stopped by the CSRF check', () => {
    renderPage(PAYLOAD);
    expect(mockUseQuery.mock.calls[0][1]).toMatchObject({
      context: { fetchOptions: { credentials: 'omit' } },
    });
  });

  it('explains a revoked or unknown link', () => {
    renderPage(null);
    expect(screen.getByText("This history isn't shared")).toBeInTheDocument();
  });

  // Rides say where the owner rode and when, so they show only on a link the
  // owner opted in, and the page never even asks for them otherwise.
  it('lists no rides, and asks for none, on a link without the opt-in', () => {
    renderPage({ ...PAYLOAD, includeRides: false });
    expect(screen.queryByRole('heading', { name: 'Rides' })).not.toBeInTheDocument();
    expect(screen.queryByText('Galbraith')).not.toBeInTheDocument();
    expect(ridesCalls().every(([, opts]) => opts.skip === true)).toBe(true);
  });

  it('lists each ride on an opted-in link, with its source attributed on the row', () => {
    renderPage({ ...PAYLOAD, includeRides: true });
    const list = screen.getByRole('heading', { name: 'Rides' }).closest('section')!;

    expect(within(list).getByText('Galbraith')).toBeInTheDocument();
    expect(within(list).getByText('Strava')).toBeInTheDocument();
    expect(within(list).getByText('Garmin Edge 840')).toBeInTheDocument();
    expect(within(list).getByText('1h 30m')).toBeInTheDocument();
    expect(within(list).getByText('Ride')).toBeInTheDocument();
  });

  // The API sends a bare calendar day, never a time. Formatting it as an
  // instant would show the day before to every viewer west of UTC.
  it('shows the day a ride was ridden as sent, whatever the viewer timezone', () => {
    renderPage({ ...PAYLOAD, includeRides: true });
    const list = screen.getByRole('heading', { name: 'Rides' }).closest('section')!;
    const expected = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date('2026-10-06T00:00:00Z')
    );
    expect(within(list).getByText(new RegExp(`^${expected}`))).toBeInTheDocument();
  });

  it('pages the rides cookieless, like the page itself, and on from where the list ends', () => {
    renderPage({ ...PAYLOAD, includeRides: true }, { rides: RIDES, hasMore: true });
    const [, opts] = ridesCalls().at(-1)!;
    expect(opts).toMatchObject({
      variables: { slug: 'abcdefghijkl', offset: 0 },
      skip: false,
      context: { fetchOptions: { credentials: 'omit' } },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Show more rides' }));
    expect(mockFetchMore).toHaveBeenCalledWith(expect.objectContaining({ variables: { offset: 2 } }));
  });
});
