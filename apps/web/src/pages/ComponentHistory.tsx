import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@apollo/client';
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowLeft, Bike as BikeIcon, Eye, TriangleAlert, Wrench } from 'lucide-react';

import { COMPONENT_HISTORY, COMPONENT_HISTORY_RIDES } from '@/graphql/componentHistory';
import { fmtDateTime, fmtDistance, fmtDuration, fmtElevation } from '@/lib/format';
import { fmtDay } from '@/lib/componentShare';
import { usePreferences } from '@/hooks/usePreferences';
import { useUserTier } from '@/hooks/useUserTier';
import { useCostInsightViewed } from '@/hooks/useCostInsightViewed';
import { fmtMoney, fmtPartsList, fmtPerHour } from '@/lib/money';
import { getComponentLabel } from '@/constants/componentLabels';
import { ProChip } from '@/components/UpgradePrompt';
import { GarminDerivedNote } from '@/components/attribution/GarminAttribution';
import { WearChart } from '@/components/history/WearChart';
import { CHART } from '@/components/history/chartTheme';
import { ComponentSharePanel } from '@/components/history/ComponentSharePanel';
import { HistoryRideList } from '@/components/history/HistoryRideList';
import RideSourceBadges from '@/components/RideSourceBadges';

/** Rides per page in the ride list. */
const RIDE_PAGE = 25;

// The conditions scale is a lightness ramp rather than a hue wheel, because
// the system has no sanctioned categorical palette and seven hues would either
// leave the palette or collapse into indistinguishable neighbours. Every bar
// is directly labelled, so colour is reinforcement rather than the signal.
// (The chart colours themselves, and why, live with WearChart.)

const CONDITION_SCALE: Record<string, string> = {
  SUNNY: '#E8E6E2',
  CLOUDY: '#9E9EA4',
  RAINY: '#788C80',
  SNOWY: '#C3CFC7',
  FOGGY: '#8A8A91',
  WINDY: '#344A3E',
  UNKNOWN: '#3A3A3E',
};

const CONDITION_LABEL: Record<string, string> = {
  SUNNY: 'Sunny',
  CLOUDY: 'Cloudy',
  RAINY: 'Rainy',
  SNOWY: 'Snowy',
  FOGGY: 'Foggy',
  WINDY: 'Windy',
  UNKNOWN: 'Unknown',
};

type Totals = {
  rideCount: number;
  durationSeconds: number;
  distanceMeters: number;
  elevationGainMeters: number;
  firstRideAt?: string | null;
  lastRideAt?: string | null;
};

type Tenure = {
  id: string;
  slotKey: string;
  installedAt: string;
  removedAt: string | null;
  synthetic: boolean;
  bike: {
    id: string;
    nickname?: string | null;
    manufacturer: string;
    model: string;
    year?: number | null;
    thumbnailUrl?: string | null;
  } | null;
  totals: Totals;
};

type HistoryPayload = {
  anchor: string | null;
  coverage: 'FULL' | 'SYNTHETIC_FALLBACK' | 'NO_TENURE_DATA';
  historyIncomplete: boolean;
  driftDetected: boolean;
  component: {
    id: string;
    type: string;
    location: string;
    brand: string;
    model: string;
    notes?: string | null;
    isStock: boolean;
    bikeId?: string | null;
    status: string;
    hoursUsed: number;
    serviceDueAtHours?: number | null;
    priorHours: number;
    lifetimeHours: number;
    hoursSinceService: number;
    lastInspectedAt?: string | null;
    installedAt?: string | null;
    lastServicedAt?: string | null;
    retiredAt?: string | null;
    replacedById?: string | null;
    purchasePriceMinor?: number | null;
    purchaseCurrency?: string | null;
    purchasedFrom?: string | null;
    /** Pro only; null for Free. */
    costSummary?: {
      currency: string;
      purchaseMinor?: number | null;
      serviceMinor: number;
      totalMinor: number;
      lifetimeHours: number;
      perHourMinor?: number | null;
      otherCurrencyCount: number;
    } | null;
  };
  lifetime: Totals;
  sinceService: Totals;
  tenures: Tenure[];
  serviceEvents: Array<{
    id: string;
    performedAt: string;
    notes?: string | null;
    kind: 'SERVICE' | 'INSPECTION';
    hoursAtService: number;
    serviceExtensionHours?: number | null;
    costMinor?: number | null;
    currency?: string | null;
    parts?: Array<{ id: string; brand: string; model: string; priceMinor?: number | null; vendor?: string | null }>;
  }>;
  conditions: Array<{ condition: string; rideCount: number; durationSeconds: number }>;
  cumulative: Array<{
    date: string;
    cumulativeHours: number;
    cumulativeDistanceMeters: number;
    cumulativeElevationGainMeters: number;
  }>;
};

type HistoryRide = {
  id: string;
  startTime: string;
  durationSeconds: number;
  distanceMeters: number;
  elevationGainMeters: number;
  elevationLossMeters?: number | null;
  trailSystem?: string | null;
  location?: string | null;
  bikeId?: string | null;
  stravaActivityId?: string | null;
  stravaDeviceName?: string | null;
  garminActivityId?: string | null;
  garminDeviceName?: string | null;
  whoopWorkoutId?: string | null;
  suuntoWorkoutId?: string | null;
};

type RidesPayload = { componentHistoryRides: { rides: HistoryRide[]; hasMore: boolean } };

function bikeLabel(bike: Tenure['bike']): string {
  if (!bike) return 'Deleted bike';
  return bike.nickname || `${bike.manufacturer} ${bike.model}`;
}

function componentTitle(c: HistoryPayload['component']): string {
  const label = getComponentLabel(c.type);
  const loc = c.location && c.location !== 'NONE' ? ` (${c.location.toLowerCase()})` : '';
  const brandModel = [c.brand, c.model].filter(Boolean).join(' ');
  return brandModel ? `${brandModel} ${label}${loc}` : `${label}${loc}`;
}

/** Where the component is right now, in one plain line. */
function placementLine(payload: HistoryPayload): string {
  const { component, tenures } = payload;
  if (component.status === 'RETIRED') {
    return component.retiredAt ? `Retired ${fmtDateTime(component.retiredAt)}` : 'Retired';
  }
  if (component.status === 'INVENTORY' || !component.bikeId) {
    return 'In inventory';
  }
  const current = tenures.find((t) => t.removedAt === null && t.bike?.id === component.bikeId);
  if (current) {
    return `On ${bikeLabel(current.bike)} since ${fmtDateTime(current.installedAt)}`;
  }
  return 'Currently installed';
}

export default function ComponentHistory() {
  const { componentId } = useParams<{ componentId: string }>();
  const { distanceUnit } = usePreferences();
  const { isPro } = useUserTier();
  const [window, setWindow] = useState<'lifetime' | 'sinceService'>('lifetime');

  const { data, loading, error } = useQuery<{ componentHistory: HistoryPayload }>(
    COMPONENT_HISTORY,
    { variables: { componentId }, skip: !componentId, fetchPolicy: 'cache-and-network' }
  );

  const payload = data?.componentHistory;
  // The Cost section (or its Pro chip) is a cost insight surface.
  useCostInsightViewed('component', Boolean(payload));

  // The rows behind the totals, following the same Lifetime / Since last
  // service toggle. Fetched alongside the history rather than after it.
  const [loadingMoreRides, setLoadingMoreRides] = useState(false);
  const ridesQuery = useQuery<RidesPayload>(COMPONENT_HISTORY_RIDES, {
    variables: { componentId, sinceService: window === 'sinceService', take: RIDE_PAGE, offset: 0 },
    skip: !componentId,
    fetchPolicy: 'cache-and-network',
  });
  const rides = ridesQuery.data?.componentHistoryRides.rides ?? [];
  const loadMoreRides = async () => {
    setLoadingMoreRides(true);
    try {
      await ridesQuery.fetchMore({
        variables: { offset: rides.length },
        updateQuery: (prev, { fetchMoreResult }) => {
          if (!fetchMoreResult) return prev;
          // Offset paging: a ride synced since the last page shifts every row
          // down one, so the next page can repeat a row already listed.
          const seen = new Set(prev.componentHistoryRides.rides.map((r) => r.id));
          return {
            componentHistoryRides: {
              ...fetchMoreResult.componentHistoryRides,
              rides: [
                ...prev.componentHistoryRides.rides,
                ...fetchMoreResult.componentHistoryRides.rides.filter((r) => !seen.has(r.id)),
              ],
            },
          };
        },
      });
    } finally {
      setLoadingMoreRides(false);
    }
  };

  // Name the bike on each row only when the part has lived on more than one.
  const rideBikeLabel = useMemo(() => {
    const tenures = payload?.tenures ?? [];
    const byId = new Map(tenures.filter((t) => t.bike).map((t) => [t.bike!.id, bikeLabel(t.bike)]));
    return byId.size > 1 ? (bikeId?: string | null) => (bikeId ? byId.get(bikeId) ?? null : null) : () => null;
  }, [payload?.tenures]);

  const conditionData = useMemo(
    () =>
      (payload?.conditions ?? [])
        .filter((c) => c.rideCount > 0)
        .sort((a, b) => b.rideCount - a.rideCount)
        .map((c) => ({
          condition: c.condition,
          label: CONDITION_LABEL[c.condition] ?? c.condition,
          rideCount: c.rideCount,
          hours: c.durationSeconds / 3600,
        })),
    [payload?.conditions]
  );

  // Every logbook entry is real work or a real inspection now. The old model
  // wrote a zero-hour ServiceLog on every install purely to position the
  // prediction anchor, which had to be filtered out here by `hoursAtService > 0`
  // — a filter that also hid a genuine service on a part with no hours on it.
  // Installs are recorded as install history instead.
  const logEntries = payload?.serviceEvents ?? [];
  // Only SERVICE entries mark the wear chart: an inspection that stood in for a
  // service moves the due point, but no work was done on the part.
  const serviceDates = useMemo(
    () => logEntries.filter((s) => s.kind === 'SERVICE').map((s) => s.performedAt),
    [logEntries]
  );

  const backTo = payload?.component.bikeId ? `/gear/${payload.component.bikeId}` : '/gear';

  if (loading && !payload) {
    return <div className="p-6 text-muted">Loading history…</div>;
  }

  if (error) {
    return (
      <div className="p-6">
        <Link to="/gear" className="text-sm text-muted hover:text-app inline-flex items-center gap-1 mb-4">
          <ArrowLeft size={14} /> Back to bikes
        </Link>
        <div className="alert-inline alert-inline-error">{error.message}</div>
      </div>
    );
  }

  if (!payload) return null;

  // Hours come from the stored, ledger-backed counters, which include declared
  // pre-Loam hours the ride-summed `lifetime` totals cannot know about. The
  // API already returns sinceService that way. Distance, elevation and ride
  // counts stay ride-derived, because a rider declaring "these wheels have 200
  // hours on them" is not declaring a mileage.
  const shown: Totals =
    window === 'lifetime'
      ? {
          ...payload.lifetime,
          durationSeconds: Math.round(payload.component.lifetimeHours * 3600),
        }
      : payload.sinceService;

  return (
    <div className="bike-detail-page p-6 max-w-5xl mx-auto">
      <Link
        to={backTo}
        className="text-sm text-muted hover:text-app inline-flex items-center gap-1 mb-4"
      >
        <ArrowLeft size={14} /> Back to bike
      </Link>

      {/* Hero */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-semibold">{componentTitle(payload.component)}</h1>
          <div className="text-muted text-sm">
            {placementLine(payload)}
            {payload.component.isStock ? ' · Stock' : ' · Aftermarket'}
          </div>
        </div>
        {payload.coverage !== 'NO_TENURE_DATA' && (
          <ComponentSharePanel
            componentId={payload.component.id}
            installedAt={
              payload.tenures[0]?.installedAt ??
              payload.component.installedAt ??
              new Date().toISOString()
            }
          />
        )}
      </div>

      {/* Derived from ride data, so contributing sources are named adjacent to
          the numbers and above the fold, as the Garmin API Brand Guidelines
          require. Matches BikeDetail and BikeHistory. */}
      <GarminDerivedNote className="mb-4" />

      {payload.coverage === 'NO_TENURE_DATA' ? (
        <div className="rounded-lg border border-border bg-surface-2 p-4 text-sm text-muted mb-5">
          This component has no recorded time on a bike yet, so there is nothing to
          total up. Install it on a bike and its rides will start accruing here.
        </div>
      ) : (
        <>
          {/* Totals */}
          <div className="flex items-center gap-2 mb-3">
            <TogglePill active={window === 'lifetime'} onClick={() => setWindow('lifetime')}>
              Lifetime
            </TogglePill>
            <TogglePill
              active={window === 'sinceService'}
              onClick={() => setWindow('sinceService')}
            >
              Since last service
            </TogglePill>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
            <StatTile label="Hours" value={fmtDuration(shown.durationSeconds)} />
            <StatTile label="Rides" value={shown.rideCount.toLocaleString()} />
            <StatTile label="Distance" value={fmtDistance(shown.distanceMeters, distanceUnit)} />
            <StatTile
              label="Elevation"
              value={fmtElevation(shown.elevationGainMeters, distanceUnit)}
            />
          </div>

          {/* Declared pre-Loam hours are stated explicitly rather than folded
              silently into the headline: the rider told us this, we did not
              measure it, and a secondhand part's history should say so. */}
          {/* Since a service, the hours are measured from that service's reading,
              so declared pre-Loam hours only remain in them while none is logged. */}
          {payload.component.priorHours > 0 && (window === 'lifetime' || !payload.anchor) && (
            <div className="text-xs text-muted mb-1">
              Includes {Math.round(payload.component.priorHours)}h declared before this
              component was tracked in Loam Logger.
            </div>
          )}


          <div className="text-xs text-muted mb-5">
            {window === 'lifetime'
              ? payload.lifetime.firstRideAt
                ? `First recorded ride ${fmtDateTime(payload.lifetime.firstRideAt)}.`
                : 'No rides recorded against this component yet.'
              : payload.anchor
              ? `Counting from the last service on ${fmtDateTime(payload.anchor)}.`
              : 'No service logged yet, so this counts every recorded ride.'}
          </div>

          {payload.historyIncomplete && (
            <div className="rounded-lg border border-border bg-surface-2 p-3 text-xs text-muted mb-5 flex gap-2">
              <TriangleAlert size={14} className="shrink-0 mt-0.5" />
              <div>
                {payload.historyIncomplete && (
                  <p>
                    Part of this component's install history is missing, so these totals
                    may understate its real life. Deleting a bike removes the records
                    linking its rides to the parts that were on it.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Cost: what the part cost to buy plus what its services cost,
              over its lifetime hours. Cream Stat Values, never tinted: money
              is history, not status. Free sees the labels with the quiet Pro
              chip in place of the numbers; the conditions card below already
              holds this page's one UpsellCard slot. */}
          <section className="bike-detail-section mb-6">
            <h2 className="bike-detail-section-title">Cost</h2>
            <p className="text-xs text-muted mb-3">
              What you paid for the part plus what its services cost, over its lifetime hours.
            </p>
            {!isPro ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {['Paid', 'Services', 'Total', 'Per ride hour'].map((label) => (
                  <StatTile key={label} label={label} value={<ProChip source="component-history-cost" />} />
                ))}
              </div>
            ) : payload.component.costSummary ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <StatTile
                    label="Paid"
                    value={
                      payload.component.costSummary.purchaseMinor != null
                        ? fmtMoney(payload.component.costSummary.purchaseMinor, payload.component.costSummary.currency)
                        : payload.component.isStock
                          ? 'Stock'
                          : 'Not recorded'
                    }
                  />
                  <StatTile
                    label="Services"
                    value={fmtMoney(payload.component.costSummary.serviceMinor, payload.component.costSummary.currency)}
                  />
                  <StatTile
                    label="Total"
                    value={fmtMoney(payload.component.costSummary.totalMinor, payload.component.costSummary.currency)}
                  />
                  <StatTile
                    label="Per ride hour"
                    value={
                      payload.component.costSummary.perHourMinor != null
                        ? fmtPerHour(payload.component.costSummary.perHourMinor, payload.component.costSummary.currency)
                        : 'Under 1 h ridden'
                    }
                  />
                </div>
                {payload.component.costSummary.otherCurrencyCount > 0 && (
                  <p className="text-xs text-muted mt-1">
                    {payload.component.costSummary.otherCurrencyCount}{' '}
                    {payload.component.costSummary.otherCurrencyCount === 1 ? 'entry' : 'entries'} in another
                    currency not included.
                  </p>
                )}
                {payload.component.purchasedFrom && (
                  <p className="text-xs text-muted mt-1">Bought from {payload.component.purchasedFrom}.</p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted">Nothing spent on record yet.</p>
            )}
          </section>

          {/* Wear over time */}
          {payload.cumulative.length > 1 && (
            <section className="bike-detail-section mb-6">
              <h2 className="bike-detail-section-title">Wear over time</h2>
              <p className="text-xs text-muted mb-3">
                Cumulative hours ridden. Service dates are marked so you can see how much
                use each interval covered.
              </p>
              <WearChart points={payload.cumulative} serviceDates={serviceDates} />
            </section>
          )}

          {/* Bikes it has lived on */}
          <section className="bike-detail-section mb-6">
            <h2 className="bike-detail-section-title">Bikes it has lived on</h2>
            <ul className="mt-2 space-y-1">
              {payload.tenures.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center gap-3 py-2 border-b border-border last:border-b-0"
                >
                  {t.bike?.thumbnailUrl ? (
                    <img
                      src={t.bike.thumbnailUrl}
                      alt=""
                      className="h-11 w-11 rounded-lg object-cover shrink-0"
                    />
                  ) : (
                    <div className="h-11 w-11 rounded-lg bg-surface-2 grid place-items-center shrink-0">
                      <BikeIcon size={16} className="text-muted" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">
                      {t.bike ? (
                        <Link to={`/gear/${t.bike.id}`} className="hover:text-mint">
                          {bikeLabel(t.bike)}
                        </Link>
                      ) : (
                        bikeLabel(t.bike)
                      )}
                    </div>
                    <div className="text-xs text-muted">
                      {fmtDateTime(t.installedAt)} –{' '}
                      {t.removedAt ? fmtDateTime(t.removedAt) : 'now'}
                      {t.synthetic && ' · reconstructed'}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold">
                      {fmtDuration(t.totals.durationSeconds)}
                    </div>
                    <div className="text-xs text-muted">
                      {t.totals.rideCount.toLocaleString()} rides ·{' '}
                      {fmtDistance(t.totals.distanceMeters, distanceUnit)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* Conditions */}
          <section className="bike-detail-section mb-6">
            <h2 className="bike-detail-section-title">Conditions ridden in</h2>
            {/* PRODUCT.md forbids invented precision, and the service engine is
                hours-only today (docs/roadmap.md). A conditions panel sitting
                beside a health badge implies causation by adjacency, so the
                relationship is stated plainly instead of left to inference. */}
            <p className="text-xs text-muted mb-3">
              Recorded from each ride's weather. Conditions are not currently factored
              into service intervals.
            </p>
            {!isPro ? (
              // A quiet gate rather than the full weather UpsellCard. Two
              // reasons: upsellCopy's tone rules cap a screen at one inline
              // card and send every other gated spot to a Pro chip, and the
              // weather card's body currently claims conditions feed service
              // estimates — which would contradict the note directly above it.
              <div className="flex items-center gap-2 text-sm text-muted">
                <span>Ride conditions are recorded with Pro.</span>
                <ProChip source="component-history-conditions" />
              </div>
            ) : conditionData.length === 0 ? (
              <p className="text-sm text-muted">
                No weather recorded for this component's rides yet.
              </p>
            ) : (
              <div style={{ height: conditionData.length * 34 + 24 }} className="w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={conditionData}
                    layout="vertical"
                    margin={{ top: 0, right: 48, bottom: 0, left: 8 }}
                  >
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="label"
                      tick={{ fill: CHART.axis, fontSize: 12 }}
                      stroke={CHART.grid}
                      width={72}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(58, 58, 62, 0.3)' }}
                      contentStyle={{
                        background: 'rgb(22, 22, 26)',
                        border: '1px solid rgba(58, 58, 62, 0.7)',
                        borderRadius: 12,
                        fontSize: 12,
                      }}
                      formatter={(v, _n, item) => [
                        `${Number(v ?? 0)} rides · ${fmtDuration(
                          Math.round(Number(item?.payload?.hours ?? 0) * 3600)
                        )}`,
                        'Rides',
                      ]}
                    />
                    <Bar dataKey="rideCount" radius={[0, 6, 6, 0]} maxBarSize={18}>
                      {/* Direct labels, so the bars stay readable without hover
                          and colour is never the only channel. */}
                      <LabelList
                        dataKey="rideCount"
                        position="right"
                        fill={CHART.axis}
                        fontSize={11}
                      />
                      {conditionData.map((c) => (
                        <Cell key={c.condition} fill={CONDITION_SCALE[c.condition] ?? CHART.axis} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          {/* Service history */}
          <section className="bike-detail-section mb-6">
            <h2 className="bike-detail-section-title">Logbook</h2>
            {logEntries.length === 0 ? (
              <p className="text-sm text-muted mt-2">Nothing logged yet.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {logEntries.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-baseline gap-3 py-2 border-b border-border last:border-b-0"
                  >
                    {s.kind === 'INSPECTION' ? (
                      <Eye size={14} className="text-muted shrink-0" />
                    ) : (
                      <Wrench size={14} className="text-muted shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm">
                        {fmtDateTime(s.performedAt)}
                        <span className="text-muted">
                          {' · '}
                          {s.kind === 'INSPECTION' ? 'Inspected' : 'Serviced'}
                          {s.kind === 'INSPECTION' && s.serviceExtensionHours != null &&
                            `, good for ${Math.round(s.serviceExtensionHours)}h more`}
                        </span>
                      </div>
                      {(s.costMinor != null || (s.parts?.length ?? 0) > 0) && (
                        <div className="text-xs text-muted">
                          {[
                            s.costMinor != null ? fmtMoney(s.costMinor, s.currency ?? undefined) : null,
                            (s.parts?.length ?? 0) > 0 ? fmtPartsList(s.parts ?? []) : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      )}
                      {s.notes && <div className="text-xs text-muted">{s.notes}</div>}
                    </div>
                    {/* A lifetime reading, which is what a mechanic writes on a
                        workshop card — not hours since the previous service. */}
                    <div className="text-xs text-muted shrink-0">
                      at {Math.round(s.hoursAtService)}h
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Rides: the rows behind the totals above, by the same rule. */}
          <section className="bike-detail-section mb-6">
            <h2 className="bike-detail-section-title">Rides</h2>
            <p className="text-xs text-muted mb-1">
              {window === 'lifetime'
                ? 'Every ride counted toward the totals above, newest first.'
                : 'Every ride since the last service, newest first.'}
            </p>
            {ridesQuery.error ? (
              <div className="alert-inline alert-inline-error mt-2">{ridesQuery.error.message}</div>
            ) : ridesQuery.loading && rides.length === 0 ? (
              <p className="text-sm text-muted mt-2">Loading rides…</p>
            ) : rides.length === 0 ? (
              <p className="text-sm text-muted mt-2">
                {window === 'lifetime' ? 'No rides recorded yet.' : 'No rides since the last service.'}
              </p>
            ) : (
              <HistoryRideList
                rides={rides.map((r) => ({
                  ...r,
                  key: r.id,
                  dateLabel: fmtDay(r.startTime),
                  note: rideBikeLabel(r.bikeId),
                  badges: <RideSourceBadges ride={r} />,
                }))}
                distanceUnit={distanceUnit}
                hasMore={ridesQuery.data?.componentHistoryRides.hasMore ?? false}
                loadingMore={loadingMoreRides}
                onLoadMore={loadMoreRides}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

function TogglePill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 py-1 rounded-full text-xs border ${
        active ? 'bg-mint/10 border-mint text-mint' : 'border-border text-muted'
      }`}
    >
      {children}
    </button>
  );
}
