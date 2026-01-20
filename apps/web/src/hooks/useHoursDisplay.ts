import { usePreferences } from './usePreferences';

/**
 * Hook for preference-aware hours display formatting.
 *
 * Returns formatting functions that respect the user's hoursDisplay preference:
 * - "total" mode: shows hours used / service interval (e.g., "780h / 800h")
 * - "remaining" mode: shows hours left until service (e.g., "20h remaining")
 */
export function useHoursDisplay() {
  const { hoursDisplay } = usePreferences();

  /**
   * Format hours for display based on user preference.
   * Returns primary text like "780h / 800h" or "20h remaining"
   */
  const formatHoursForDisplay = (
    hoursRemaining: number | null | undefined,
    hoursSinceService: number | null | undefined,
    serviceIntervalHours: number | null | undefined
  ): string => {
    if (hoursDisplay === 'total') {
      const used = hoursSinceService != null ? Math.max(0, hoursSinceService).toFixed(1) : '---';
      const total = serviceIntervalHours != null ? serviceIntervalHours.toFixed(0) : '---';
      return `${used}h / ${total}h`;
    } else {
      const remaining = hoursRemaining != null ? Math.max(0, hoursRemaining).toFixed(1) : '---';
      return `${remaining}h remaining`;
    }
  };

  /**
   * Compact format for tiles and small spaces.
   * Returns text like "780/800h" or "20h"
   */
  const formatHoursCompact = (
    hoursRemaining: number | null | undefined,
    hoursSinceService: number | null | undefined,
    serviceIntervalHours: number | null | undefined
  ): string => {
    if (hoursDisplay === 'total') {
      const used = hoursSinceService != null ? Math.max(0, hoursSinceService).toFixed(1) : '---';
      const total = serviceIntervalHours != null ? serviceIntervalHours.toFixed(0) : '---';
      return `${used}/${total}h`;
    } else {
      const remaining = hoursRemaining != null ? Math.max(0, hoursRemaining).toFixed(1) : '---';
      return `${remaining}h`;
    }
  };

  return { hoursDisplay, formatHoursForDisplay, formatHoursCompact };
}
