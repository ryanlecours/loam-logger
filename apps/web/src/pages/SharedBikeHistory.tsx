import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { gql, useQuery } from '@apollo/client';
import { Bike as BikeIcon, Wrench, ArrowUpDown } from 'lucide-react';
import { fmtDistance, fmtDuration, fmtDateTime } from '@/lib/format';
import { getComponentLabel } from '@/constants/componentLabels';

const SHARED_BIKE_HISTORY = gql`
  query SharedBikeHistory($slug: String!) {
    sharedBikeHistory(slug: $slug) {
      bike {
        name
        manufacturer
        model
        year
        thumbnailUrl
      }
      serviceEvents {
        performedAt
        notes
        component {
          type
          location
          brand
          model
        }
      }
      installs {
        eventType
        occurredAt
        component {
          type
          location
          brand
          model
        }
      }
      totals {
        rideCount
        totalDistanceMeters
        totalDurationSeconds
        totalElevationGainMeters
        serviceEventCount
        installEventCount
      }
    }
  }
`;

type SharedComponent = {
  type: string;
  location: string;
  brand: string;
  model: string;
};

type TimelineEvent = {
  kind: 'service' | 'install' | 'remove';
  occurredAt: string;
  component: SharedComponent;
  notes?: string | null;
};

function componentDisplay(component: SharedComponent): string {
  const label = getComponentLabel(component.type);
  const loc = component.location && component.location !== 'NONE' ? ` (${component.location.toLowerCase()})` : '';
  const brandModel = [component.brand, component.model].filter(Boolean).join(' ');
  return brandModel ? `${label}${loc} — ${brandModel}` : `${label}${loc}`;
}

export default function SharedBikeHistory() {
  const { slug } = useParams<{ slug: string }>();

  const { data, loading, error } = useQuery(SHARED_BIKE_HISTORY, {
    variables: { slug },
    skip: !slug,
    fetchPolicy: 'cache-first',
  });

  const payload = data?.sharedBikeHistory ?? null;

  const timeline: TimelineEvent[] = useMemo(() => {
    if (!payload) return [];
    const events: TimelineEvent[] = [
      ...payload.serviceEvents.map((e: { performedAt: string; notes: string | null; component: SharedComponent }) => ({
        kind: 'service' as const,
        occurredAt: e.performedAt,
        component: e.component,
        notes: e.notes,
      })),
      ...payload.installs.map((e: { eventType: string; occurredAt: string; component: SharedComponent }) => ({
        kind: e.eventType === 'REMOVED' ? ('remove' as const) : ('install' as const),
        occurredAt: e.occurredAt,
        component: e.component,
      })),
    ];
    return events.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  }, [payload]);

  if (loading && !payload) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted">
        Loading service history…
      </div>
    );
  }

  if (error || !payload) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-6 text-center">
        <BikeIcon className="h-8 w-8 text-muted" />
        <h1 className="text-xl font-semibold text-white">This bike isn't shared</h1>
        <p className="max-w-sm text-sm text-muted">
          The link may have been turned off by the owner, or it never existed.
        </p>
        <Link to="/" className="mt-2 text-sm text-primary hover:opacity-80 transition">
          Loam Logger — mountain bike maintenance tracking
        </Link>
      </div>
    );
  }

  const { bike, totals } = payload;

  return (
    <div className="min-h-screen py-10 px-4">
      <div className="container max-w-2xl mx-auto space-y-6">
        <header className="flex items-center gap-4">
          {bike.thumbnailUrl ? (
            <img src={bike.thumbnailUrl} alt={bike.name} className="h-16 w-16 rounded-xl object-contain bg-surface-2" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-surface-2">
              <BikeIcon className="h-7 w-7 text-muted" />
            </div>
          )}
          <div>
            <h1 className="text-2xl font-bold text-white">{bike.name}</h1>
            <p className="text-sm text-muted">
              {[bike.year, bike.manufacturer, bike.model].filter(Boolean).join(' ')} · Service history
            </p>
          </div>
        </header>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <ShareStat label="Rides" value={totals.rideCount.toLocaleString()} />
          <ShareStat label="Distance" value={fmtDistance(totals.totalDistanceMeters, 'mi')} />
          <ShareStat label="Ride time" value={fmtDuration(totals.totalDurationSeconds)} />
          <ShareStat label="Services" value={String(totals.serviceEventCount)} />
        </div>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Wrench log</h2>
          {timeline.length === 0 ? (
            <p className="text-sm text-muted">No service or install events recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {timeline.map((event, i) => (
                <li
                  key={`${event.kind}-${event.occurredAt}-${i}`}
                  className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3"
                >
                  {event.kind === 'service' ? (
                    <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  ) : (
                    <ArrowUpDown className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm text-white">
                      {event.kind === 'service'
                        ? 'Serviced'
                        : event.kind === 'install'
                          ? 'Installed'
                          : 'Removed'}
                      {' · '}
                      {componentDisplay(event.component)}
                    </p>
                    <p className="text-xs text-muted">{fmtDateTime(event.occurredAt)}</p>
                    {event.notes && <p className="mt-1 text-xs text-muted/80">{event.notes}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="border-t border-white/10 pt-4 text-center">
          <p className="text-xs text-muted">
            Service history tracked with{' '}
            <Link to="/" className="text-primary hover:opacity-80 transition">
              Loam Logger
            </Link>
            {' '}— track your own bike, free.
          </p>
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
