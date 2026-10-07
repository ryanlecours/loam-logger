import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@apollo/client';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowLeft, Bike as BikeIcon, Eye, TriangleAlert, Wrench } from 'lucide-react';

import { COMPONENT_HISTORY } from '@/graphql/componentHistory';
import { fmtDateTime, fmtDistance, fmtDuration, fmtElevation } from '@/lib/format';
import { usePreferences } from '@/hooks/usePreferences';
import { useUserTier } from '@/hooks/useUserTier';
import { getComponentLabel } from '@/constants/componentLabels';
import { ProChip } from '@/components/UpgradePrompt';
import { GarminDerivedNote } from '@/components/attribution/GarminAttribution';

// Chart colors, per the Data Visualization section of DESIGN.md.
//
// Two rules are load-bearing here. First, the health ramp (mahogany /
// terracotta / danger) is reserved for actual component health — a wear chart
// or a conditions breakdown borrowing it would dilute the one signal the
// product exists to deliver. Second, marks follow the Two Inks Rule: fills go
// behind things (areas, bars), inks go on things (lines, labels).
//
// The conditions scale is a lightness ramp rather than a hue wheel, because
// the system has no sanctioned categorical palette and seven hues would either
// leave the palette or collapse into indistinguishable neighbours. Every bar
// is directly labelled, so colour is reinforcement rather than the signal.
const CHART = {
  axis: '#8A8A91', // stone-light: the dimmest usable text tone
  grid: 'rgba(58, 58, 62, 0.5)', // ash, translucent
  wearLine: '#9CB0A4', // mint ink
  wearFill: 'rgba(120, 140, 128, 0.25)', // sage fill
  serviceMark: '#788C80', // sage ink
};

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
    hoursSinceInspection: number;
    inspectionDueAtHours?: number | null;
    lastInspectedAt?: string | null;
    installedAt?: string | null;
    lastServicedAt?: string | null;
    retiredAt?: string | null;
    replacedById?: string | null;
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
  }>;
  conditions: Array<{ condition: string; rideCount: number; durationSeconds: number }>;
  cumulative: Array<{
    date: string;
    cumulativeHours: number;
    cumulativeDistanceMeters: number;
    cumulativeElevationGainMeters: number;
  }>;
};

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

  const chartData = useMemo(
    () =>
      (payload?.cumulative ?? []).map((p) => ({
        date: p.date,
        label: new Date(p.date).toLocaleDateString(undefined, {
          month: 'short',
          year: '2-digit',
        }),
        hours: Number(p.cumulativeHours.toFixed(1)),
      })),
    [payload?.cumulative]
  );

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
  // Only SERVICE entries mark the wear chart: an inspection resets the
  // inspection clock without altering the service interval the chart shows.
  const serviceMarks = useMemo(
    () => logEntries.filter((s) => s.kind === 'SERVICE'),
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

          {payload.component.inspectionDueAtHours != null && (
            <div className="text-xs text-muted mb-1">
              Inspection: {Math.round(payload.component.hoursSinceInspection)}h since last
              check, every {Math.round(payload.component.inspectionDueAtHours)}h.
              {payload.component.lastInspectedAt
                ? ` Last inspected ${fmtDateTime(payload.component.lastInspectedAt)}.`
                : ' Not yet inspected.'}
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

          {/* Wear over time */}
          {chartData.length > 1 && (
            <section className="bike-detail-section mb-6">
              <h2 className="bike-detail-section-title">Wear over time</h2>
              <p className="text-xs text-muted mb-3">
                Cumulative hours ridden. Service dates are marked so you can see how much
                use each interval covered.
              </p>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke={CHART.grid} vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: CHART.axis, fontSize: 11 }}
                      stroke={CHART.grid}
                      minTickGap={24}
                    />
                    <YAxis
                      tick={{ fill: CHART.axis, fontSize: 11 }}
                      stroke={CHART.grid}
                      width={40}
                      unit="h"
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'rgb(22, 22, 26)',
                        border: '1px solid rgba(58, 58, 62, 0.7)',
                        borderRadius: 12,
                        fontSize: 12,
                      }}
                      labelStyle={{ color: CHART.axis }}
                      formatter={(v) => [`${Number(v ?? 0)}h`, 'Cumulative']}
                    />
                    {serviceMarks.map((s) => {
                      const label = new Date(s.performedAt).toLocaleDateString(undefined, {
                        month: 'short',
                        year: '2-digit',
                      });
                      return (
                        <ReferenceLine
                          key={s.id}
                          x={label}
                          stroke={CHART.serviceMark}
                          strokeDasharray="3 3"
                        />
                      );
                    })}
                    <Area
                      type="monotone"
                      dataKey="hours"
                      stroke={CHART.wearLine}
                      strokeWidth={2}
                      fill={CHART.wearFill}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
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
                        </span>
                      </div>
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
        </>
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
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
