import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@apollo/client';
import { Bike as BikeIcon, Eye, Wrench } from 'lucide-react';

import { SHARED_COMPONENT_HISTORY } from '@/graphql/componentShare';
import { fmtDateTime, fmtDistance, fmtDuration, fmtElevation } from '@/lib/format';
import { fmtDay, rangeLabel, type ComponentShareScope } from '@/lib/componentShare';
import { getComponentLabel } from '@/constants/componentLabels';
import { WearChart } from '@/components/history/WearChart';
import {
  GarminDerivedNote,
  GarminTrademarkNotice,
} from '@/components/attribution/GarminAttribution';

type Totals = {
  rideCount: number;
  durationSeconds: number;
  distanceMeters: number;
  elevationGainMeters?: number;
  firstRideAt?: string | null;
};

type SharedPayload = {
  component: { type: string; location: string; brand: string; model: string; isStock: boolean };
  scope: ComponentShareScope;
  windowStart: string | null;
  windowEnd: string | null;
  totals: Totals & { elevationGainMeters: number };
  declaredPriorHours: number;
  bikes: Array<{
    bike: { manufacturer: string; model: string; year?: number | null; thumbnailUrl?: string | null } | null;
    installedAt: string;
    removedAt: string | null;
    totals: Totals;
  }>;
  logbook: Array<{
    performedAt: string;
    kind: 'SERVICE' | 'INSPECTION';
    hoursAtService: number;
    serviceExtensionHours?: number | null;
  }>;
  cumulative: Array<{ date: string; cumulativeHours: number }>;
  contributingSources: string[];
};

function componentTitle(c: SharedPayload['component']): string {
  const label = getComponentLabel(c.type);
  const loc = c.location && c.location !== 'NONE' ? ` (${c.location.toLowerCase()})` : '';
  const brandModel = [c.brand, c.model].filter(Boolean).join(' ');
  return brandModel ? `${brandModel} ${label}${loc}` : `${label}${loc}`;
}

/** What window this link shows, in one line. */
function windowLine(p: SharedPayload): string {
  switch (p.scope) {
    case 'LIFETIME':
      return 'Lifetime history';
    case 'SINCE_SERVICE':
      return p.windowStart
        ? `Since its last service on ${fmtDay(p.windowStart)}`
        : 'Since its last service (none logged, so every ride counts)';
    case 'RANGE':
      return p.windowStart && p.windowEnd ? rangeLabel(p.windowStart, p.windowEnd) : 'Date range';
  }
}

function bikeLabel(bike: SharedPayload['bikes'][number]['bike']): string {
  if (!bike) return 'A bike since deleted';
  return [bike.year, bike.manufacturer, bike.model].filter(Boolean).join(' ');
}

/**
 * Public, read-only view of one share link: one window of one component's
 * history. Shows only what the API's allowlist sends, so there is no owner,
 * no notes and no weather here to leave out.
 */
export default function SharedComponentHistory() {
  const { slug } = useParams<{ slug: string }>();
  const { data, loading, error } = useQuery<{ sharedComponentHistory: SharedPayload | null }>(
    SHARED_COMPONENT_HISTORY,
    { variables: { slug }, skip: !slug, fetchPolicy: 'cache-first' }
  );
  const payload = data?.sharedComponentHistory ?? null;

  const serviceDates = useMemo(
    () => (payload?.logbook ?? []).filter((l) => l.kind === 'SERVICE').map((l) => l.performedAt),
    [payload?.logbook]
  );

  if (loading && !payload) {
    return <div className="min-h-screen flex items-center justify-center text-muted">Loading history…</div>;
  }

  if (error || !payload) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-6 text-center">
        <Wrench className="h-8 w-8 text-muted" />
        <h1 className="text-xl font-semibold text-white">This history isn't shared</h1>
        <p className="max-w-sm text-sm text-muted">
          The link may have been revoked by the owner, or it never existed.
        </p>
        <Link to="/" className="mt-2 text-sm text-primary hover:opacity-80 transition">
          Loam Logger: mountain bike maintenance tracking
        </Link>
      </div>
    );
  }

  const { totals } = payload;

  return (
    <div className="min-h-screen py-10 px-4">
      <div className="container max-w-2xl mx-auto space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-white">{componentTitle(payload.component)}</h1>
          <p className="text-sm text-muted">
            {windowLine(payload)}
            {payload.component.isStock ? ' · Stock' : ' · Aftermarket'}
          </p>
        </header>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <ShareStat label="Hours" value={fmtDuration(totals.durationSeconds)} />
          <ShareStat label="Rides" value={totals.rideCount.toLocaleString()} />
          <ShareStat label="Distance" value={fmtDistance(totals.distanceMeters, 'mi')} />
          <ShareStat label="Elevation" value={fmtElevation(totals.elevationGainMeters, 'mi')} />
        </div>

        {payload.declaredPriorHours > 0 && (
          <p className="text-xs text-muted">
            Includes {Math.round(payload.declaredPriorHours)}h the owner declared from before this part was
            tracked in Loam Logger.
          </p>
        )}

        {payload.cumulative.length > 1 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Wear over time</h2>
            <p className="text-xs text-muted">Cumulative hours ridden. Service dates are marked.</p>
            <WearChart points={payload.cumulative} serviceDates={serviceDates} />
          </section>
        )}

        {payload.bikes.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Bikes it was on</h2>
            <ul className="space-y-2">
              {payload.bikes.map((t, i) => (
                <li
                  key={`${t.installedAt}-${i}`}
                  className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3"
                >
                  {t.bike?.thumbnailUrl ? (
                    <img src={t.bike.thumbnailUrl} alt="" className="h-10 w-10 rounded-lg object-contain bg-surface-2" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-2">
                      <BikeIcon className="h-4 w-4 text-muted" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white truncate">{bikeLabel(t.bike)}</p>
                    <p className="text-xs text-muted">
                      {fmtDay(t.installedAt)} – {t.removedAt ? fmtDay(t.removedAt) : 'now'}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-white">{fmtDuration(t.totals.durationSeconds)}</p>
                    <p className="text-xs text-muted">{t.totals.rideCount.toLocaleString()} rides</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Logbook</h2>
          {payload.logbook.length === 0 ? (
            <p className="text-sm text-muted">Nothing logged in this window.</p>
          ) : (
            <ul className="space-y-2">
              {payload.logbook.map((l, i) => (
                <li
                  key={`${l.performedAt}-${i}`}
                  className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3"
                >
                  {l.kind === 'INSPECTION' ? (
                    <Eye className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                  ) : (
                    <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white">
                      {l.kind === 'INSPECTION' ? 'Inspected' : 'Serviced'}
                      {l.kind === 'INSPECTION' && l.serviceExtensionHours != null &&
                        `, good for ${Math.round(l.serviceExtensionHours)}h more`}
                    </p>
                    <p className="text-xs text-muted">{fmtDateTime(l.performedAt)}</p>
                  </div>
                  <p className="text-xs text-muted shrink-0">at {Math.round(l.hoursAtService)}h</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="border-t border-white/10 pt-4 text-center space-y-2">
          <p className="text-xs text-muted">
            Component history tracked with{' '}
            <Link to="/" className="text-primary hover:opacity-80 transition">
              Loam Logger
            </Link>
            . Track your own bike, free.
          </p>
          {/* Downstream attribution, as on the shared bike page: the totals and
              chart above are derived from the contributing providers' data. */}
          {payload.contributingSources.includes('garmin') && (
            <>
              <GarminDerivedNote />
              <GarminTrademarkNotice />
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

function ShareStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="text-sm font-semibold text-white">{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}
