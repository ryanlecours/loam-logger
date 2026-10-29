/**
 * Strava historical import, shared by the rider-driven route
 * (`GET /strava/backfill/fetch`) and the backfill worker's automatic import
 * after a connect. The route keeps the HTTP concerns (auth, the tier gate,
 * the response shape); this module owns the Strava calls and the ride writes.
 *
 * Strava has no history-replay API like Garmin's, so this pulls the activity
 * list for the window and stores each cycling activity, crediting component
 * hours as it goes. Existing rides are only patched where a field is missing.
 */

import { getValidStravaToken } from './strava-token';
import { fetchStravaDeviceName } from './strava-device';
import { prisma } from './prisma';
import { formatLatLon, reverseGeocode } from './location';
import { incrementBikeComponentHours } from './component-hours';
import { logError } from './logger';
import { enqueueWeatherJob } from './queue';
import { captureRideSynced } from './posthog';

// Type definitions for Strava API responses
// Based on: https://developers.strava.com/docs/reference/#api-Activities-getLoggedInAthleteActivities
export type StravaActivity = {
  id: number;
  name: string;
  type: string; // e.g., "Ride"
  sport_type: string; // e.g., "MountainBikeRide", "GravelRide"
  start_date: string; // ISO 8601 UTC
  start_date_local: string; // ISO 8601 local
  timezone: string; // e.g., "(GMT-08:00) America/Los_Angeles"
  elapsed_time: number; // seconds
  moving_time: number; // seconds
  distance: number; // meters
  total_elevation_gain: number; // meters
  gear_id: string | null; // Strava bike/gear ID
  average_heartrate?: number;
  max_heartrate?: number;
  average_speed?: number; // m/s
  max_speed?: number; // m/s
  // Location coordinates - we use these for reverse geocoding
  start_latlng: [number, number] | null;
  end_latlng: [number, number] | null;
  // Note: location_city/state/country are unreliable, so we ignore them
  // Additional fields from sample
  trainer?: boolean;
  commute?: boolean;
  manual?: boolean;
  private?: boolean;
  device_name?: string;
  average_watts?: number;
  kilojoules?: number;
  suffer_score?: number;
};

const CYCLING_SPORT_TYPES = [
  'Ride',
  'MountainBikeRide',
  'GravelRide',
  'VirtualRide',
  'EBikeRide',
  'EMountainBikeRide',
  'Handcycle',
];

/** Strava max is 200, but 50 is safer. */
const PER_PAGE = 50;
/** 50 pages × 50 = 2500 activities per window. Caps a runaway loop. */
const MAX_PAGES = 50;

/** Thrown when the rider has no usable Strava token. Not retryable. */
export class StravaNotConnectedError extends Error {
  constructor() {
    super('Strava not connected or token expired. Please reconnect your Strava account.');
    this.name = 'StravaNotConnectedError';
  }
}

export type StravaImportSummary = {
  totalActivities: number;
  cyclingActivities: number;
  imported: number;
  updated: number;
  geocoded: number;
  unmappedGears: Array<{ gearId: string; rideCount: number }>;
};

/**
 * Import every cycling activity Strava lists between `startDate` and
 * `endDate` for the rider. `via` is passed through to the `ride_synced`
 * analytics event so a rider-driven import and the automatic one after a
 * connect stay distinguishable.
 */
export async function importStravaActivities(opts: {
  userId: string;
  startDate: Date;
  endDate: Date;
  via: 'sync' | 'backfill';
}): Promise<StravaImportSummary> {
  const { userId, startDate, endDate, via } = opts;

  const accessToken = await getValidStravaToken(userId);
  if (!accessToken) {
    throw new StravaNotConnectedError();
  }

  // Calculate Unix timestamps
  const afterTimestamp = Math.floor(startDate.getTime() / 1000);
  const beforeTimestamp = Math.floor(endDate.getTime() / 1000);

  console.log(`[Strava Sync] Fetching activities from ${startDate.toISOString()} to ${endDate.toISOString()}`);

  // Fetch activities from Strava API
  // https://developers.strava.com/docs/reference/#api-Activities-getLoggedInAthleteActivities
  const activities: StravaActivity[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const url = new URL('https://www.strava.com/api/v3/athlete/activities');
    url.searchParams.set('after', afterTimestamp.toString());
    url.searchParams.set('before', beforeTimestamp.toString());
    url.searchParams.set('page', page.toString());
    url.searchParams.set('per_page', PER_PAGE.toString());

    const activitiesRes = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    if (!activitiesRes.ok) {
      const text = await activitiesRes.text();
      console.error(`[Strava Sync] Failed to fetch activities: ${activitiesRes.status} ${text}`);
      throw new Error(`Failed to fetch activities: ${activitiesRes.status}`);
    }

    const pageActivities = (await activitiesRes.json()) as StravaActivity[];
    activities.push(...pageActivities);

    console.log(`[Strava Sync] Fetched page ${page}: ${pageActivities.length} activities`);

    if (pageActivities.length < PER_PAGE) {
      hasMore = false;
    } else {
      page++;
    }

    if (page > MAX_PAGES) {
      console.warn(`[Strava Sync] Reached page limit (${MAX_PAGES}), stopping pagination`);
      hasMore = false;
    }
  }

  console.log(`[Strava Sync] Total activities fetched: ${activities.length}`);

  const cyclingActivities = activities.filter((a) => CYCLING_SPORT_TYPES.includes(a.sport_type));

  console.log(`[Strava Sync] Cycling activities: ${cyclingActivities.length}`);

  // Import each cycling activity
  let newCount = 0;
  let updatedCount = 0;
  let geocodedCount = 0;

  for (const activity of cyclingActivities) {
    const existing = await prisma.ride.findUnique({
      where: { stravaActivityId: activity.id.toString() },
      select: { id: true, startLat: true, startLng: true, location: true },
    });

    const lat = activity.start_latlng?.[0] ?? null;
    const lon = activity.start_latlng?.[1] ?? null;
    const initialLocation = formatLatLon(lat, lon);

    if (existing) {
      // Backfill any fields the existing ride is missing (e.g. startLat/startLng
      // for rides imported before coord persistence was added).
      const patch: Record<string, unknown> = {};
      if (existing.startLat == null && lat != null) patch.startLat = lat;
      if (existing.startLng == null && lon != null) patch.startLng = lon;

      // Resolve location before writing so we don't do two round-trips
      // for the same field: prefer a geocoded name, fall back to the
      // coord-formatted string only if geocoding fails or isn't possible.
      if (!existing.location) {
        let resolvedLocation: string | null = initialLocation;
        if (lat !== null && lon !== null) {
          try {
            const locationResult = await reverseGeocode(lat, lon);
            if (locationResult) {
              resolvedLocation = locationResult.title;
              geocodedCount++;
            }
          } catch (err) {
            console.warn(`[Strava Sync] Failed to geocode ride ${existing.id}:`, err);
          }
        }
        if (resolvedLocation) patch.location = resolvedLocation;
      }

      if (Object.keys(patch).length > 0) {
        await prisma.ride.update({
          where: { id: existing.id },
          data: patch,
        });
        updatedCount++;
      }

      // Only enqueue weather if coords were JUST added on this sync.
      // Rides that already had coords either already have weather or have
      // a job in flight — the weather worker would skip them anyway, but
      // enqueuing N redundant jobs per re-sync is a needless Redis hit.
      if (patch.startLat !== undefined && patch.startLng !== undefined) {
        enqueueWeatherJob({ rideId: existing.id }).catch((err) =>
          logError(`Strava Sync weather enqueue ${existing.id}`, err)
        );
      }

      continue;
    }

    // New ride — full create. Field derivation and bike lookup happen
    // here (not earlier) so we don't pay for gear-mapping + user-bikes
    // queries or trivially-derived fields on every existing-ride
    // iteration during a re-sync.
    const distanceMeters = activity.distance;
    const elevationGainMeters = activity.total_elevation_gain;
    const startTime = new Date(activity.start_date);
    const durationHours = Math.max(0, activity.moving_time) / 3600;

    let bikeId: string | null = null;
    if (activity.gear_id) {
      const mapping = await prisma.stravaGearMapping.findUnique({
        where: {
          userId_stravaGearId: {
            userId,
            stravaGearId: activity.gear_id,
          },
        },
      });
      bikeId = mapping?.bikeId ?? null;
    }
    if (!bikeId) {
      const userBikes = await prisma.bike.findMany({
        where: { userId },
        select: { id: true },
      });
      if (userBikes.length === 1) {
        bikeId = userBikes[0].id;
      }
    }

    // The list endpoint omits device_name; fetch it best-effort so a ride
    // recorded on a Garmin device and imported via Strava can still be
    // attributed to Garmin. A rate-limited lookup just leaves it null.
    const stravaDeviceName = await fetchStravaDeviceName(accessToken, activity.id);

    const ride = await prisma.$transaction(async (tx) => {
      const createdRide = await tx.ride.create({
        data: {
          userId,
          stravaActivityId: activity.id.toString(),
          stravaGearId: activity.gear_id ?? null,
          stravaDeviceName,
          startTime,
          durationSeconds: activity.moving_time,
          distanceMeters,
          elevationGainMeters,
          averageHr: activity.average_heartrate ? Math.round(activity.average_heartrate) : null,
          rideType: activity.sport_type,
          notes: activity.name || null,
          bikeId,
          location: initialLocation,
          startLat: lat,
          startLng: lon,
        },
      });

      if (bikeId) {
        await incrementBikeComponentHours(tx, {
          userId,
          bikeId,
          hoursDelta: durationHours,
          startTime: createdRide.startTime,
        });
      }

      return createdRide;
    });

    captureRideSynced(userId, 'strava', via);

    if (lat !== null && lon !== null) {
      try {
        const locationResult = await reverseGeocode(lat, lon);
        if (locationResult) {
          await prisma.ride.update({
            where: { id: ride.id },
            data: { location: locationResult.title },
          });
          geocodedCount++;
        }
      } catch (err) {
        console.warn(`[Strava Sync] Failed to geocode ride ${ride.id}:`, err);
      }

      enqueueWeatherJob({ rideId: ride.id }).catch((err) =>
        logError(`Strava Sync weather enqueue ${ride.id}`, err)
      );
    }

    newCount++;
  }

  console.log(`[Strava Sync] New: ${newCount}, Updated: ${updatedCount}, Geocoded: ${geocodedCount}`);

  // Detect unmapped gears
  const unmappedGearIds = cyclingActivities
    .filter((a) => a.gear_id)
    .map((a) => a.gear_id!)
    .filter((id, idx, arr) => arr.indexOf(id) === idx);

  const unmappedGears: Array<{ gearId: string; rideCount: number }> = [];
  for (const gearId of unmappedGearIds) {
    const mapping = await prisma.stravaGearMapping.findUnique({
      where: {
        userId_stravaGearId: { userId, stravaGearId: gearId },
      },
    });
    if (!mapping) {
      const rideCount = cyclingActivities.filter((a) => a.gear_id === gearId).length;
      unmappedGears.push({ gearId, rideCount });
    }
  }

  console.log(`[Strava Sync] Unmapped gears: ${unmappedGears.length}`);

  return {
    totalActivities: activities.length,
    cyclingActivities: cyclingActivities.length,
    imported: newCount,
    updated: updatedCount,
    geocoded: geocodedCount,
    unmappedGears,
  };
}
