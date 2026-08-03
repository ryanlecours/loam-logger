import { stravaRecordingDevice } from '@loam/shared';
import {
  getRideSources,
  getRideSourceLabel,
  type RideWithSource,
  type RideSource,
} from '../utils/rideSource';

/**
 * Provider badges for one ride, rendered beside the ride's title.
 *
 * Renders EVERY contributing source rather than a single ranked one. A ride
 * matched across Strava and Garmin contains Garmin device-sourced data, and the
 * Garmin API Brand Guidelines require attribution wherever that data appears —
 * the previous single-badge behavior silently dropped it, because Strava
 * outranks Garmin.
 *
 * Garmin badges carry the device model ("Garmin Edge 840") and opt out of the
 * shared uppercase transform; see the `.source-badge-garmin-attribution` rule.
 *
 * This is a title-level/primary display in the guidelines' terms, so callers
 * must keep it in the visible header row — never inside a tooltip, a footnote,
 * or a collapsed container.
 */
export default function RideSourceBadges({
  ride,
  className = '',
}: {
  ride: RideWithSource;
  className?: string;
}) {
  const sources = getRideSources(ride);
  // A non-Garmin recording device (Wahoo, phone, ...) Strava reported. Garmin
  // devices already appear as their own attribution badge, so this only fills
  // the gap for everything else — shown muted, since it is info, not a badge.
  const device = stravaRecordingDevice(ride);

  return (
    <>
      {sources.map((source: RideSource) => (
        <span
          key={source}
          className={[
            'source-badge',
            `source-badge-${source}`,
            source === 'garmin' ? 'source-badge-garmin-attribution' : '',
            className,
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {getRideSourceLabel(ride, source)}
        </span>
      ))}
      {device && (
        <span className={['source-device', className].filter(Boolean).join(' ')}>{device}</span>
      )}
    </>
  );
}
