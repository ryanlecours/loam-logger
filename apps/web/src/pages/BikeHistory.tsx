import { Suspense, lazy, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@apollo/client';
import { ArrowLeft, Bike as BikeIcon, CalendarClock, Check, FileDown, MinusCircle, PlusCircle, TriangleAlert, Wrench } from 'lucide-react';

import { BIKE_HISTORY } from '@/graphql/bikeHistory';
import { BULK_UPDATE_BIKE_COMPONENT_INSTALLS } from '@/graphql/bike';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { EditServiceModal, type EditableServiceLog } from '@/components/dashboard/EditServiceModal';
import { EditInstallModal, type EditableInstallEvent } from '@/components/dashboard/EditInstallModal';
import { fmtDateTime, fmtDistance, fmtDuration, fmtElevation, dateInputToIsoNoon, todayDateInput } from '@/lib/format';
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
    hasPairedEvent: boolean;
  } | null>(null);
  // Multi-select state — enabled via "Edit dates" button. Only INSTALLED
  // events are selectable; the backend's bulk mutation only moves
  // installedAt (not removedAt), and mixing both in one selection would
  // create ambiguous "apply this date to what?" semantics. REMOVED
  // events remain individually editable via the single-event modal.
  // Stored as install base ids (composite id with the ":installed" suffix
  // stripped) so we can send them straight to the backend.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedInstallIds, setSelectedInstallIds] = useState<Set<string>>(new Set());
  const [bulkDateOpen, setBulkDateOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const range = useMemo(() => computeTimeframeRange(timeframe), [timeframe]);

  const { data, loading, error } = useQuery(BIKE_HISTORY, {
    variables: { bikeId, ...range },
    skip: !bikeId,
    fetchPolicy: 'cache-and-network',
  });

  const [bulkUpdateInstalls] = useMutation(BULK_UPDATE_BIKE_COMPONENT_INSTALLS, {
    refetchQueries: bikeId ? [{ query: BIKE_HISTORY, variables: { bikeId } }] : [],
  });

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedInstallIds(new Set());
  };

  const toggleInstallSelection = (baseId: string) => {
    setSelectedInstallIds((prev) => {
      const next = new Set(prev);
      if (next.has(baseId)) next.delete(baseId);
      else next.add(baseId);
      return next;
    });
  };

  const handleBulkSetDate = async (isoDate: string) => {
    setBulkBusy(true);
    setBulkError(null);
    try {
      await bulkUpdateInstalls({
        variables: {
          input: {
            ids: Array.from(selectedInstallIds),
            installedAt: isoDate,
          },
        },
      });
      setBulkDateOpen(false);
      exitSelectionMode();
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'Failed to update install dates.');
    } finally {
      setBulkBusy(false);
    }
  };

  const payload = data?.bikeHistory;

  // Base install-row ids that have BOTH an INSTALLED and a REMOVED event in
  // the timeline. Used so the delete-confirmation copy on EditInstallModal
  // can accurately say "one event" vs "both events."
  const pairedBaseIds = useMemo(() => {
    if (!payload) return new Set<string>();
    const baseOf = (id: string) => {
      const i = id.lastIndexOf(':');
      return i > 0 ? id.slice(0, i) : id;
    };
    const seen = new Map<string, number>();
    for (const ev of payload.installs) {
      const base = baseOf(ev.id);
      seen.set(base, (seen.get(base) ?? 0) + 1);
    }
    return new Set(Array.from(seen).filter(([, n]) => n >= 2).map(([b]) => b));
  }, [payload]);

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
            <div className="flex items-center gap-2">
              {!selectionMode ? (
                <Button variant="outline" size="sm" onClick={() => setSelectionMode(true)}>
                  <CalendarClock size={14} className="icon-left" />
                  Edit dates
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={exitSelectionMode}>
                  Cancel
                </Button>
              )}
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
                    {items.map((item) => {
                      // Real id-based keys so re-ordering (timeframe change,
                      // toggle filter) doesn't leave React reusing DOM nodes
                      // against the wrong items.
                      const key =
                        item.kind === 'ride'
                          ? `r:${item.ride.id}`
                          : item.kind === 'service'
                          ? `s:${item.service.id}`
                          : `i:${item.install.id}`;
                      return (
                      <li key={key} className="py-2 border-b border-border last:border-b-0">
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
                        {item.kind === 'install' && (() => {
                          const baseIdx = item.install.id.lastIndexOf(':');
                          const baseId =
                            baseIdx > 0 ? item.install.id.slice(0, baseIdx) : item.install.id;
                          const isInstallEvent = item.install.eventType === 'INSTALLED';
                          const isSelectable = selectionMode && isInstallEvent;
                          const isSelected = isSelectable && selectedInstallIds.has(baseId);
                          return (
                            <InstallRow
                              install={item.install}
                              selectable={isSelectable}
                              selected={isSelected}
                              onEdit={() => {
                                if (selectionMode) {
                                  if (isSelectable) toggleInstallSelection(baseId);
                                  return;
                                }
                                setEditingInstall({
                                  event: {
                                    id: item.install.id,
                                    eventType: item.install.eventType,
                                    occurredAt: item.install.occurredAt,
                                  },
                                  componentLabel: componentDisplay(item.install.component),
                                  hasPairedEvent: pairedBaseIds.has(baseId),
                                });
                              }}
                            />
                          );
                        })()}
                      </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {editingService && (
        <EditServiceModal
          log={editingService.log}
          componentLabel={editingService.componentLabel}
          bikeId={bikeId}
          onClose={() => setEditingService(null)}
        />
      )}

      {editingInstall && (
        <EditInstallModal
          event={editingInstall.event}
          componentLabel={editingInstall.componentLabel}
          bikeId={bikeId}
          hasPairedEvent={editingInstall.hasPairedEvent}
          onClose={() => setEditingInstall(null)}
        />
      )}

      {/* Bulk action bar, pinned to the bottom of the viewport while in
          selection mode. Always rendered (not conditional) so the
          transition in/out feels intentional; visibility is gated by
          the `hidden` class swap. */}
      {selectionMode && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface-2/95 backdrop-blur px-4 py-3">
          <div className="mx-auto max-w-3xl flex items-center justify-between gap-3">
            <span className="text-sm">
              <span className="font-semibold">{selectedInstallIds.size}</span> selected
              {selectedInstallIds.size === 0 && (
                <span className="text-muted"> &middot; tap install events to select</span>
              )}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={exitSelectionMode}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setBulkError(null);
                  setBulkDateOpen(true);
                }}
                disabled={selectedInstallIds.size === 0}
              >
                <CalendarClock size={14} className="icon-left" />
                Set date
              </Button>
            </div>
          </div>
        </div>
      )}

      <BulkDateModal
        isOpen={bulkDateOpen}
        count={selectedInstallIds.size}
        busy={bulkBusy}
        error={bulkError}
        onClose={() => setBulkDateOpen(false)}
        onConfirm={handleBulkSetDate}
      />
    </div>
  );
}

function BulkDateModal({
  isOpen,
  count,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  count: number;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (isoDate: string) => void;
}) {
  // Seeded with today; if the user enters a date, closes, reopens — they
  // get their last entry back, which matches iOS/Android native forms.
  const [dateValue, setDateValue] = useState(todayDateInput());
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Set date for ${count} install${count === 1 ? '' : 's'}`} size="sm" footer={
      <>
        <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => dateValue && onConfirm(dateInputToIsoNoon(dateValue))}
          disabled={busy || !dateValue}
        >
          {busy ? 'Updating…' : 'Apply'}
        </Button>
      </>
    }>
      <div className="space-y-3">
        <input
          type="date"
          value={dateValue}
          max={todayDateInput()}
          onChange={(e) => setDateValue(e.target.value)}
          className="log-service-date-input w-full"
        />
        <p className="text-xs text-muted">
          Updates the installed date for all selected install events. Matching baseline service
          anchors move alongside automatically.
        </p>
        {error && (
          <div className="alert-inline alert-inline-error">
            <TriangleAlert size={14} />
            {error}
          </div>
        )}
      </div>
    </Modal>
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

function InstallRow({
  install,
  onEdit,
  selectable = false,
  selected = false,
}: {
  install: HistoryInstallEvent;
  onEdit?: () => void;
  selectable?: boolean;
  selected?: boolean;
}) {
  const Icon = install.eventType === 'INSTALLED' ? PlusCircle : MinusCircle;
  const verb = install.eventType === 'INSTALLED' ? 'Installed' : 'Removed';
  return (
    <button
      type="button"
      onClick={onEdit}
      className={`w-full text-left flex items-baseline justify-between gap-3 hover:bg-surface-2/40 rounded px-1 -mx-1 py-0.5 ${selected ? 'bg-mint/10' : ''}`}
      aria-label={`Edit ${verb.toLowerCase()} event for ${componentDisplay(install.component)}`}
    >
      {selectable && (
        <span
          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${selected ? 'bg-mint border-mint' : 'border-border'}`}
          aria-hidden
        >
          {selected && <Check size={10} className="text-white" />}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">
          {verb} · {componentDisplay(install.component)}
        </div>
        <div className="text-xs text-muted">{fmtDateTime(install.occurredAt)}</div>
      </div>
      <Icon size={14} className="text-muted shrink-0" />
    </button>
  );
}
