import { Suspense, lazy, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@apollo/client';
import { ArrowLeft, Bike as BikeIcon, FileDown, MinusCircle, PlusCircle, Wrench } from 'lucide-react';

import { BIKE_HISTORY } from '@/graphql/bikeHistory';
import { Button } from '@/components/ui/Button';
import { EditServiceModal, type EditableServiceLog } from '@/components/dashboard/EditServiceModal';
import { EditInstallModal, type EditableInstallEvent } from '@/components/dashboard/EditInstallModal';
import { fmtDateTime, fmtDistance, fmtDuration, fmtElevation } from '@/lib/format';
import { usePreferences } from '@/hooks/usePreferences';
import { getComponentLabel } from '@/constants/componentLabels';
import {
  bikeName,
  computeTimeframeRange,
  mergeAndGroupByYear,
  TIMEFRAME_LABEL,
  type ComponentLite,
  type HistoryInstallEvent,
  type HistoryRide,
  type HistoryServiceEvent,
  type Timeframe,
} from '@/lib/bikeHistory';

const BikeHistoryPdfButton = lazy(() => import('@/components/history/BikeHistoryPdfButton'));

function componentDisplay(component: ComponentLite): string {
  const label = getComponentLabel(component.type);
  const loc = component.location && component.location !== 'NONE' ? ` (${component.location.toLowerCase()})` : '';
  const brandModel = [component.brand, component.model].filter(Boolean).join(' ');
  return brandModel ? `${label}${loc} — ${brandModel}` : `${label}${loc}`;
}

export default function BikeHistory() {
  const { bikeId } = useParams<{ bikeId: string }>();
  const { distanceUnit } = usePreferences();
  const [timeframe, setTimeframe] = useState<Timeframe>('all');
  const [showRides, setShowRides] = useState(true);
  const [showService, setShowService] = useState(true);
  const [editingService, setEditingService] = useState<{
    log: EditableServiceLog;
    componentLabel: string;
  } | null>(null);
  const [editingInstall, setEditingInstall] = useState<{
    event: EditableInstallEvent;
    componentLabel: string;
  } | null>(null);

  const range = useMemo(() => computeTimeframeRange(timeframe), [timeframe]);

  const { data, loading, error } = useQuery(BIKE_HISTORY, {
    variables: { bikeId, ...range },
    skip: !bikeId,
    fetchPolicy: 'cache-and-network',
  });

  const payload = data?.bikeHistory;
  const yearGroups = useMemo(() => {
    if (!payload) return [];
    return mergeAndGroupByYear({
      rides: payload.rides,
      serviceEvents: payload.serviceEvents,
      installs: payload.installs,
      showRides,
      showService,
    });
  }, [payload, showRides, showService]);

  if (!bikeId) {
    return <div className="p-6">Missing bike id.</div>;
  }

  return (
    <div className="bike-history-page mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4">
        <Link to={`/gear/${bikeId}`} className="text-sm text-muted hover:underline inline-flex items-center gap-1">
          <ArrowLeft size={14} /> Back to bike
        </Link>
      </div>

      {loading && !payload && (
        <div className="text-muted">Loading history…</div>
      )}
      {error && (
        <div className="text-danger">Couldn't load history: {error.message}</div>
      )}

      {payload && (
        <>
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h1 className="text-2xl font-semibold">{bikeName(payload.bike)}</h1>
              <div className="text-muted text-sm">
                {payload.bike.year ? `${payload.bike.year} · ` : ''}History
              </div>
            </div>
            <Suspense fallback={<Button variant="outline" size="sm" disabled><FileDown size={14} className="icon-left" /> Preparing…</Button>}>
              <BikeHistoryPdfButton
                bike={payload.bike}
                totals={payload.totals}
                yearGroups={yearGroups}
                distanceUnit={distanceUnit}
                timeframeLabel={TIMEFRAME_LABEL[timeframe]}
                truncated={payload.truncated}
              />
            </Suspense>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            <TotalChip label="Rides" value={payload.totals.rideCount.toLocaleString()} />
            <TotalChip label="Distance" value={fmtDistance(payload.totals.totalDistanceMeters, distanceUnit)} />
            <TotalChip label="Elevation" value={fmtElevation(payload.totals.totalElevationGainMeters, distanceUnit)} />
            <TotalChip label="Service events" value={(payload.totals.serviceEventCount + payload.totals.installEventCount).toLocaleString()} />
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-4">
            <label className="text-xs text-muted mr-1">Timeframe</label>
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value as Timeframe)}
              className="timeframe-select"
            >
              {(Object.keys(TIMEFRAME_LABEL) as Timeframe[]).map((tf) => (
                <option key={tf} value={tf}>{TIMEFRAME_LABEL[tf]}</option>
              ))}
            </select>
            <div className="mx-2 h-4 w-px bg-border" />
            <TogglePill active={showRides} onClick={() => setShowRides((v) => !v)}>
              Rides
            </TogglePill>
            <TogglePill active={showService} onClick={() => setShowService((v) => !v)}>
              Service & Installs
            </TogglePill>
          </div>

          {payload.truncated && (
            <div className="text-xs text-muted mb-3">
              Showing the most recent entries. Some older events may be cut off for very long histories.
            </div>
          )}

          {yearGroups.length === 0 ? (
            <div className="bike-history-empty border border-border rounded-lg p-8 text-center text-muted">
              No events in this timeframe.
            </div>
          ) : (
            <div className="bike-history-timeline space-y-6">
              {yearGroups.map(({ year, items }) => (
                <section key={year}>
                  <h2 className="text-sm font-semibold text-muted uppercase tracking-wider mb-2">
                    {year}
                  </h2>
                  <ul className="space-y-1">
                    {items.map((item, idx) => (
                      <li key={`${item.kind}-${idx}`} className="py-2 border-b border-border last:border-b-0">
                        {item.kind === 'ride' && <RideRow ride={item.ride} distanceUnit={distanceUnit} />}
                        {item.kind === 'service' && (
                          <ServiceRow
                            service={item.service}
                            onEdit={() =>
                              setEditingService({
                                log: {
                                  id: item.service.id,
                                  performedAt: item.service.performedAt,
                                  notes: item.service.notes,
                                  hoursAtService: item.service.hoursAtService,
                                },
                                componentLabel: componentDisplay(item.service.component),
                              })
                            }
                          />
                        )}
                        {item.kind === 'install' && (
                          <InstallRow
                            install={item.install}
                            onEdit={() =>
                              setEditingInstall({
                                event: {
                                  id: item.install.id,
                                  eventType: item.install.eventType,
                                  occurredAt: item.install.occurredAt,
                                },
                                componentLabel: componentDisplay(item.install.component),
                              })
                            }
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      <EditServiceModal
        log={editingService?.log ?? null}
        componentLabel={editingService?.componentLabel ?? ''}
        bikeId={bikeId}
        onClose={() => setEditingService(null)}
      />

      <EditInstallModal
        event={editingInstall?.event ?? null}
        componentLabel={editingInstall?.componentLabel ?? ''}
        bikeId={bikeId}
        onClose={() => setEditingInstall(null)}
      />
    </div>
  );
}

function TotalChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

function TogglePill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs border ${active ? 'bg-mint/10 border-mint text-mint' : 'border-border text-muted'}`}
    >
      {children}
    </button>
  );
}

function RideRow({ ride, distanceUnit }: { ride: HistoryRide; distanceUnit: 'mi' | 'km' }) {
  const title = ride.trailSystem || ride.location || `${ride.rideType} ride`;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">{title}</div>
        <div className="text-xs text-muted">
          {fmtDateTime(ride.startTime)} · {fmtDuration(ride.durationSeconds)} · {fmtDistance(ride.distanceMeters, distanceUnit)} · {fmtElevation(ride.elevationGainMeters, distanceUnit)}
        </div>
      </div>
      <BikeIcon size={14} className="text-muted shrink-0" />
    </div>
  );
}

function ServiceRow({ service, onEdit }: { service: HistoryServiceEvent; onEdit?: () => void }) {
  return (
    <button
      type="button"
      onClick={onEdit}
      className="w-full text-left flex items-baseline justify-between gap-3 hover:bg-surface-2/40 rounded px-1 -mx-1 py-0.5"
      aria-label={`Edit service for ${componentDisplay(service.component)}`}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">
          Service · {componentDisplay(service.component)}
        </div>
        <div className="text-xs text-muted truncate">
          {fmtDateTime(service.performedAt)} · {service.hoursAtService.toFixed(0)} hrs
          {service.notes ? ` · ${service.notes}` : ''}
        </div>
      </div>
      <Wrench size={14} className="text-muted shrink-0" />
    </button>
  );
}

function InstallRow({ install, onEdit }: { install: HistoryInstallEvent; onEdit?: () => void }) {
  const Icon = install.eventType === 'INSTALLED' ? PlusCircle : MinusCircle;
  const verb = install.eventType === 'INSTALLED' ? 'Installed' : 'Removed';
  return (
    <button
      type="button"
      onClick={onEdit}
      className="w-full text-left flex items-baseline justify-between gap-3 hover:bg-surface-2/40 rounded px-1 -mx-1 py-0.5"
      aria-label={`Edit ${verb.toLowerCase()} event for ${componentDisplay(install.component)}`}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">
          {verb} · {componentDisplay(install.component)}
        </div>
        <div className="text-xs text-muted">{fmtDateTime(install.occurredAt)}</div>
      </div>
      <Icon size={14} className="text-muted shrink-0" />
    </button>
  );
}
