import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import { FaWrench, FaChevronDown, FaChevronUp, FaEdit, FaTimes, FaPlus, FaCheck } from 'react-icons/fa';
import { BIKES } from '@/graphql/bikes';
import { LOG_COMPONENT_SERVICE } from '@/graphql/logComponentService';
import { formatComponentLabel } from '@/utils/formatters';

interface ServiceHistoryFormProps {
  bikeId: string;
  onComplete?: () => void;
}

interface ServiceEntry {
  id: string;
  componentId: string;
  componentLabel: string;
  year: number;
  month: number;
  day: number | null;
  time: string;
}

interface ComponentPrediction {
  componentId: string;
  componentType: string;
  location?: string | null;
  brand: string;
  model: string;
}

interface BikeData {
  id: string;
  predictions?: {
    components?: ComponentPrediction[];
  } | null;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 20 }, (_, i) => CURRENT_YEAR - i);

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

/**
 * Build ISO date string from user-entered date components.
 * Uses UTC to avoid timezone shift issues - the date/time entered is stored as-is.
 * For example, if user enters "January 15, 2024 at 2:00 PM", it's stored as
 * "2024-01-15T14:00:00.000Z" and will display back as the same date/time.
 */
function buildServiceDate(year: number, month: number, day: number | null, time: string): string {
  const d = day || 1;
  if (time && day) {
    const [hours, minutes] = time.split(':').map(Number);
    return new Date(Date.UTC(year, month - 1, d, hours, minutes, 0, 0)).toISOString();
  }
  return new Date(Date.UTC(year, month - 1, d, 0, 0, 0, 0)).toISOString();
}

function formatEntryDate(entry: ServiceEntry): string {
  const monthName = MONTHS[entry.month - 1];
  if (entry.day) {
    const suffix = entry.time ? ` at ${entry.time}` : '';
    return `${monthName} ${entry.day}, ${entry.year}${suffix}`;
  }
  return `${monthName} ${entry.year}`;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function ServiceHistoryForm({ bikeId, onComplete }: ServiceHistoryFormProps) {
  const [expanded, setExpanded] = useState(false);
  const [showExactDate, setShowExactDate] = useState(false);

  // Form state
  const [selectedComponentId, setSelectedComponentId] = useState('');
  const [serviceYear, setServiceYear] = useState(CURRENT_YEAR);
  const [serviceMonth, setServiceMonth] = useState(new Date().getMonth() + 1);
  const [serviceDay, setServiceDay] = useState<number | null>(null);
  const [serviceTime, setServiceTime] = useState('');

  // Entry list
  const [entries, setEntries] = useState<ServiceEntry[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Submission state
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch bike components
  const { data: bikesData, loading: loadingComponents } = useQuery(BIKES, {
    fetchPolicy: 'cache-and-network',
  });

  const [logService] = useMutation(LOG_COMPONENT_SERVICE);

  // Get components for this specific bike
  const components = useMemo(() => {
    if (!bikesData?.bikes) return [];
    const bike = bikesData.bikes.find((b: BikeData) => b.id === bikeId);
    return bike?.predictions?.components ?? [];
  }, [bikesData, bikeId]);

  // Get component label by ID
  const getComponentLabel = (componentId: string): string => {
    const comp = components.find((c: ComponentPrediction) => c.componentId === componentId);
    if (!comp) return 'Unknown Component';
    const typeLabel = formatComponentLabel({ componentType: comp.componentType, location: comp.location });
    return `${typeLabel} - ${comp.brand} ${comp.model}`;
  };

  // Reset form to defaults
  const resetForm = () => {
    setSelectedComponentId('');
    setServiceYear(CURRENT_YEAR);
    setServiceMonth(new Date().getMonth() + 1);
    setServiceDay(null);
    setServiceTime('');
    setShowExactDate(false);
    setEditingId(null);
  };

  // Validate day for given month/year
  const validateDay = (day: number | null, month: number, year: number): boolean => {
    if (day === null) return true;
    const maxDays = getDaysInMonth(year, month);
    return day >= 1 && day <= maxDays;
  };

  // Check if date is in the future
  // When day is specified: compare exact date
  // When day is null (month/year only): allow current month, reject future months
  const isDateInFuture = (year: number, month: number, day: number | null): boolean => {
    const now = new Date();

    if (day !== null) {
      // Exact date specified - compare against today
      const checkDate = new Date(year, month - 1, day);
      // Compare dates only (ignore time)
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return checkDate > todayStart;
    }

    // Month/year only - allow current month, reject future months
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-indexed

    if (year > currentYear) return true;
    if (year === currentYear && month > currentMonth) return true;
    return false;
  };

  // Add or update entry
  const handleAddEntry = () => {
    if (!selectedComponentId) {
      setError('Please select a component');
      return;
    }

    if (!validateDay(serviceDay, serviceMonth, serviceYear)) {
      setError(`Invalid day for ${MONTHS[serviceMonth - 1]} ${serviceYear}`);
      return;
    }

    if (isDateInFuture(serviceYear, serviceMonth, serviceDay)) {
      setError('Service date cannot be in the future');
      return;
    }

    setError(null);

    const entry: ServiceEntry = {
      id: editingId || generateId(),
      componentId: selectedComponentId,
      componentLabel: getComponentLabel(selectedComponentId),
      year: serviceYear,
      month: serviceMonth,
      day: serviceDay,
      time: serviceTime,
    };

    if (editingId) {
      // Update existing entry
      setEntries(prev => prev.map(e => e.id === editingId ? entry : e));
    } else {
      // Add new entry
      setEntries(prev => [...prev, entry]);
    }

    resetForm();
  };

  // Edit an entry
  const handleEditEntry = (entry: ServiceEntry) => {
    setSelectedComponentId(entry.componentId);
    setServiceYear(entry.year);
    setServiceMonth(entry.month);
    setServiceDay(entry.day);
    setServiceTime(entry.time);
    setShowExactDate(entry.day !== null || entry.time !== '');
    setEditingId(entry.id);
  };

  // Delete an entry
  const handleDeleteEntry = (id: string) => {
    setEntries(prev => prev.filter(e => e.id !== id));
    if (editingId === id) {
      resetForm();
    }
  };

  // Save all entries in parallel
  const handleSaveAll = async () => {
    if (entries.length === 0) return;

    setSaving(true);
    setError(null);

    try {
      // Execute all mutations in parallel for better performance
      const results = await Promise.allSettled(
        entries.map(entry => {
          const performedAt = buildServiceDate(entry.year, entry.month, entry.day, entry.time);
          return logService({
            variables: { id: entry.componentId, performedAt }
          });
        })
      );

      // Check for failures
      const failures = results.filter((r) => r.status === 'rejected');
      const successes = results.filter((r) => r.status === 'fulfilled');

      if (failures.length > 0) {
        // Remove only the successfully saved entries, keep failures for retry
        const failedIndices = new Set(
          results.map((r, i) => r.status === 'rejected' ? i : -1).filter(i => i >= 0)
        );
        const failedEntries = entries.filter((_, i) => failedIndices.has(i));
        setEntries(failedEntries);

        console.error('Some service entries failed to save:', failures.map(f => (f as PromiseRejectedResult).reason));
        setError(`Failed to save ${failures.length} of ${entries.length} entries. ${successes.length > 0 ? `${successes.length} saved successfully.` : ''} Please try again.`);
      } else {
        // All succeeded
        setEntries([]);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
        onComplete?.();
      }
    } catch (err) {
      // This shouldn't happen with allSettled, but handle just in case
      console.error('Unexpected error saving service history:', err);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Loading state
  if (loadingComponents && !bikesData) {
    return (
      <div className="w-full p-4 rounded-lg border-2 border-app bg-surface">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
            <FaWrench className="text-accent" />
          </div>
          <span className="text-muted">Loading components...</span>
        </div>
      </div>
    );
  }

  // No components available
  if (components.length === 0) {
    return (
      <div className="w-full p-4 rounded-lg border-2 border-app bg-surface">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
            <FaWrench className="text-accent" />
          </div>
          <div>
            <span className="font-medium text-primary">Log Service History</span>
            <p className="text-sm text-muted">No components available yet</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full rounded-lg border-2 border-app overflow-hidden">
      {/* Header - always visible */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center justify-between bg-surface hover:bg-surface-hover transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
            {saveSuccess ? (
              <FaCheck className="text-green-400" />
            ) : (
              <FaWrench className="text-accent" />
            )}
          </div>
          <div className="text-left">
            <span className="font-medium text-primary">Log Service History</span>
            {entries.length > 0 && (
              <span className="ml-2 text-xs bg-accent/20 text-accent px-2 py-0.5 rounded-full">
                {entries.length} pending
              </span>
            )}
            {saveSuccess && (
              <span className="ml-2 text-xs text-green-400">Saved!</span>
            )}
          </div>
        </div>
        {expanded ? (
          <FaChevronUp className="w-4 h-4 text-muted" />
        ) : (
          <FaChevronDown className="w-4 h-4 text-muted" />
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="p-4 border-t border-app bg-surface-2 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-danger">
              {error}
            </div>
          )}

          {/* Component selector */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-muted">Component *</label>
            <select
              value={selectedComponentId}
              onChange={(e) => setSelectedComponentId(e.target.value)}
              className="w-full input-soft"
            >
              <option value="">Select a component...</option>
              {components.map((comp: ComponentPrediction) => (
                <option key={comp.componentId} value={comp.componentId}>
                  {formatComponentLabel({ componentType: comp.componentType, location: comp.location })} - {comp.brand} {comp.model}
                </option>
              ))}
            </select>
          </div>

          {/* Month and Year selectors */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-muted">Month *</label>
              <select
                value={serviceMonth}
                onChange={(e) => setServiceMonth(Number(e.target.value))}
                className="w-full input-soft"
              >
                {MONTHS.map((month, i) => (
                  <option key={i + 1} value={i + 1}>{month}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-muted">Year *</label>
              <select
                value={serviceYear}
                onChange={(e) => setServiceYear(Number(e.target.value))}
                className="w-full input-soft"
              >
                {YEARS.map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Optional exact date toggle */}
          <div>
            <button
              type="button"
              onClick={() => setShowExactDate(!showExactDate)}
              className="text-sm text-accent hover:text-accent-hover transition-colors"
            >
              {showExactDate ? '− Hide exact date' : '+ Add exact date (optional)'}
            </button>

            {/* Day and time are both optional - users often remember the day but not time */}
            {showExactDate && (
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-muted">Day</label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={serviceDay ?? ''}
                    onChange={(e) => setServiceDay(e.target.value ? Number(e.target.value) : null)}
                    className="w-full input-soft"
                    placeholder="1-31"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-muted">Time (optional)</label>
                  <input
                    type="time"
                    value={serviceTime}
                    onChange={(e) => setServiceTime(e.target.value)}
                    className="w-full input-soft"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Add/Update button */}
          <button
            type="button"
            onClick={handleAddEntry}
            disabled={!selectedComponentId}
            className={`
              w-full py-2 px-4 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2
              ${selectedComponentId
                ? 'bg-accent/20 text-accent hover:bg-accent/30'
                : 'bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed'
              }
            `}
          >
            {editingId ? (
              <>
                <FaEdit className="w-3 h-3" />
                Update Entry
              </>
            ) : (
              <>
                <FaPlus className="w-3 h-3" />
                Add Service
              </>
            )}
          </button>

          {/* Pending entries list */}
          {entries.length > 0 && (
            <div className="border-t border-app pt-4 space-y-2">
              <p className="text-sm font-medium text-muted">Pending Services:</p>
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className={`
                    flex items-center justify-between p-3 rounded-lg bg-surface border
                    ${editingId === entry.id ? 'border-accent' : 'border-app'}
                  `}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-primary truncate">
                      {formatComponentLabel({
                        componentType: components.find((c: ComponentPrediction) => c.componentId === entry.componentId)?.componentType || '',
                        location: components.find((c: ComponentPrediction) => c.componentId === entry.componentId)?.location
                      })}
                    </p>
                    <p className="text-xs text-muted">{formatEntryDate(entry)}</p>
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    <button
                      type="button"
                      onClick={() => handleEditEntry(entry)}
                      className="p-1.5 rounded hover:bg-surface-hover text-muted hover:text-primary transition-colors"
                      title="Edit"
                    >
                      <FaEdit className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteEntry(entry.id)}
                      className="p-1.5 rounded hover:bg-red-500/10 text-muted hover:text-danger transition-colors"
                      title="Delete"
                    >
                      <FaTimes className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}

              {/* Save all button */}
              <button
                type="button"
                onClick={handleSaveAll}
                disabled={saving}
                className={`
                  w-full py-3 px-4 rounded-lg text-sm font-medium transition-all mt-3
                  ${saving
                    ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-wait'
                    : 'bg-accent text-white hover:bg-accent-hover'
                  }
                `}
              >
                {saving ? 'Saving...' : `Save Service History (${entries.length})`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
