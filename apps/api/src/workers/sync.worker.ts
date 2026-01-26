import { Worker, Job, DelayedError } from 'bullmq';
import { getQueueConnection } from '../lib/queue/connection';
import { acquireLock, releaseLock } from '../lib/rate-limit';
import { prisma } from '../lib/prisma';
import { getValidStravaToken } from '../lib/strava-token';
import { getValidGarminToken } from '../lib/garmin-token';
import { deriveLocation, deriveLocationAsync, shouldApplyAutoLocation } from '../lib/location';
import { logger } from '../lib/logger';
import { config } from '../config/env';
import type { SyncJobData, SyncJobName, SyncProvider } from '../lib/queue/sync.queue';
import type { Prisma } from '@prisma/client';

// Retry delay when lock acquisition fails (30 seconds)
const LOCK_RETRY_DELAY = 30 * 1000;

// Cycling sport types for Strava
const STRAVA_CYCLING_TYPES = [
  'Ride',
  'MountainBikeRide',
  'GravelRide',
  'VirtualRide',
  'EBikeRide',
  'EMountainBikeRide',
  'Handcycle',
];

// Cycling activity types for Garmin
const GARMIN_CYCLING_TYPES = [
  'cycling',
  'bmx',
  'cyclocross',
  'downhill_biking',
  'e_bike_fitness',
  'e_bike_mountain',
  'e_enduro_mtb',
  'enduro_mtb',
  'gravel_cycling',
  'indoor_cycling',
  'mountain_biking',
  'recumbent_cycling',
  'road_biking',
  'track_cycling',
  'virtual_ride',
  'handcycling',
  'indoor_handcycling',
];

// Strava activity type
type StravaActivity = {
  id: number;
  name: string;
  sport_type: string;
  start_date: string;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  total_elevation_gain: number;
  gear_id?: string | null;
  average_heartrate?: number;
  max_heartrate?: number;
  location_city?: string | null;
  location_state?: string | null;
  location_country?: string | null;
  start_latlng?: [number, number] | null;
  [key: string]: unknown;
};

// Garmin activity type
type GarminActivity = {
  summaryId: string;
  activityId?: number;
  activityType: string;
  activityName?: string;
  startTimeInSeconds: number;
  startTimeOffsetInSeconds?: number;
  durationInSeconds: number;
  distanceInMeters?: number;
  elevationGainInMeters?: number;
  totalElevationGainInMeters?: number;
  averageHeartRateInBeatsPerMinute?: number;
  maxHeartRateInBeatsPerMinute?: number;
  locationName?: string;
  startLatitudeInDegrees?: number;
  startLongitudeInDegrees?: number;
  beginLatitude?: number;
  beginLongitude?: number;
  [key: string]: unknown;
};

/**
 * Process a sync job.
 * Acquires a distributed lock to prevent concurrent syncs for the same user/provider.
 */
async function processSyncJob(job: Job<SyncJobData, void, SyncJobName>): Promise<void> {
  const { userId, provider } = job.data;
  const jobName = job.name;

  console.log(`[SyncWorker] Processing ${jobName} for user ${userId}, provider ${provider}`);

  // Acquire distributed lock to prevent concurrent syncs
  const lockResult = await acquireLock('sync', provider, userId);

  if (!lockResult.acquired) {
    console.log(`[SyncWorker] Could not acquire lock for ${provider}:${userId}, delaying job`);
    // Delay the job and retry
    throw new DelayedError(`Lock not available, retrying in ${LOCK_RETRY_DELAY / 1000}s`);
  }

  try {
    switch (jobName) {
      case 'syncLatest':
        await syncLatestActivities(userId, provider);
        break;
      case 'syncActivity':
        if (!job.data.activityId) {
          throw new Error('syncActivity requires activityId');
        }
        await syncSingleActivity(userId, provider, job.data.activityId);
        break;
      default:
        throw new Error(`Unknown sync job type: ${jobName}`);
    }
  } finally {
    // Always release the lock
    await releaseLock(lockResult.lockKey, lockResult.lockValue);
    console.log(`[SyncWorker] Released lock for ${provider}:${userId}`);
  }
}

/**
 * Sync latest activities from a provider.
 * Fetches recent activities (last 30 days) and upserts them.
 */
async function syncLatestActivities(userId: string, provider: SyncProvider): Promise<void> {
  console.log(`[SyncWorker] Syncing latest activities for ${provider}`);

  switch (provider) {
    case 'strava':
      await syncStravaLatest(userId);
      break;
    case 'garmin':
      await syncGarminLatest(userId);
      break;
    case 'suunto':
      console.log(`[SyncWorker] Suunto sync not yet implemented`);
      break;
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Sync a single activity by ID.
 */
async function syncSingleActivity(
  userId: string,
  provider: SyncProvider,
  activityId: string
): Promise<void> {
  console.log(`[SyncWorker] Syncing single activity ${activityId} from ${provider}`);

  switch (provider) {
    case 'strava':
      await syncStravaActivity(userId, activityId);
      break;
    case 'garmin':
      await syncGarminActivity(userId, activityId);
      break;
    case 'suunto':
      console.log(`[SyncWorker] Suunto sync not yet implemented`);
      break;
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// ============================================================================
// STRAVA SYNC
// ============================================================================

async function syncStravaLatest(userId: string): Promise<void> {
  const accessToken = await getValidStravaToken(userId);

  if (!accessToken) {
    throw new Error('No valid Strava token available');
  }

  // Fetch activities from the last 30 days
  const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
  const now = Math.floor(Date.now() / 1000);

  const url = new URL('https://www.strava.com/api/v3/athlete/activities');
  url.searchParams.set('after', thirtyDaysAgo.toString());
  url.searchParams.set('before', now.toString());
  url.searchParams.set('per_page', '50');

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Strava API error: ${response.status} ${text}`);
  }

  const activities = (await response.json()) as StravaActivity[];
  console.log(`[SyncWorker] Fetched ${activities.length} Strava activities`);

  // Filter to cycling activities
  const cyclingActivities = activities.filter((a) =>
    STRAVA_CYCLING_TYPES.includes(a.sport_type)
  );

  console.log(`[SyncWorker] Processing ${cyclingActivities.length} cycling activities`);

  for (const activity of cyclingActivities) {
    await upsertStravaActivity(userId, activity);
  }

  console.log(`[SyncWorker] Strava sync complete for user ${userId}`);
}

async function syncStravaActivity(userId: string, activityId: string): Promise<void> {
  const accessToken = await getValidStravaToken(userId);

  if (!accessToken) {
    throw new Error('No valid Strava token available');
  }

  const response = await fetch(
    `https://www.strava.com/api/v3/activities/${activityId}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Strava API error: ${response.status} ${text}`);
  }

  const activity = (await response.json()) as StravaActivity;

  if (!STRAVA_CYCLING_TYPES.includes(activity.sport_type)) {
    console.log(`[SyncWorker] Skipping non-cycling activity: ${activity.sport_type}`);
    return;
  }

  await upsertStravaActivity(userId, activity);
}

async function upsertStravaActivity(userId: string, activity: StravaActivity): Promise<void> {
  const distanceMiles = activity.distance * 0.000621371;
  const elevationGainFeet = activity.total_elevation_gain * 3.28084;
  const startTime = new Date(activity.start_date);

  // Look up bike mapping
  let bikeId: string | null = null;
  if (activity.gear_id) {
    const mapping = await prisma.stravaGearMapping.findUnique({
      where: {
        userId_stravaGearId: { userId, stravaGearId: activity.gear_id },
      },
    });
    bikeId = mapping?.bikeId ?? null;
  }

  // Auto-assign if user has exactly one bike
  if (!bikeId) {
    const userBikes = await prisma.bike.findMany({
      where: { userId },
      select: { id: true },
    });
    if (userBikes.length === 1) {
      bikeId = userBikes[0].id;
    }
  }

  const autoLocation = deriveLocation({
    city: activity.location_city ?? null,
    state: activity.location_state ?? null,
    country: activity.location_country ?? null,
    lat: activity.start_latlng?.[0] ?? null,
    lon: activity.start_latlng?.[1] ?? null,
  });

  await prisma.$transaction(async (tx) => {
    const existing = await tx.ride.findUnique({
      where: { stravaActivityId: activity.id.toString() },
      select: { durationSeconds: true, bikeId: true, location: true },
    });

    const locationUpdate = shouldApplyAutoLocation(existing?.location ?? null, autoLocation);

    const ride = await tx.ride.upsert({
      where: { stravaActivityId: activity.id.toString() },
      create: {
        userId,
        stravaActivityId: activity.id.toString(),
        stravaGearId: activity.gear_id ?? null,
        startTime,
        durationSeconds: activity.moving_time,
        distanceMiles,
        elevationGainFeet,
        averageHr: activity.average_heartrate ? Math.round(activity.average_heartrate) : null,
        rideType: activity.sport_type,
        notes: activity.name || null,
        bikeId,
        location: autoLocation,
      },
      update: {
        startTime,
        stravaGearId: activity.gear_id ?? null,
        durationSeconds: activity.moving_time,
        distanceMiles,
        elevationGainFeet,
        averageHr: activity.average_heartrate ? Math.round(activity.average_heartrate) : null,
        rideType: activity.sport_type,
        notes: activity.name || null,
        bikeId,
        ...(locationUpdate !== undefined ? { location: locationUpdate } : {}),
      },
    });

    // Sync component hours
    await syncBikeComponentHours(
      tx,
      userId,
      { bikeId: existing?.bikeId ?? null, durationSeconds: existing?.durationSeconds ?? null },
      { bikeId: ride.bikeId ?? null, durationSeconds: ride.durationSeconds }
    );
  });

  console.log(`[SyncWorker] Upserted Strava activity ${activity.id}`);
}

// ============================================================================
// GARMIN SYNC
// ============================================================================

async function syncGarminLatest(userId: string): Promise<void> {
  // Guard: Block unprompted pulls during Garmin verification
  // This prevents calling GET /rest/activities which Garmin flags as "unprompted pull"
  if (config.garminVerificationMode) {
    logger.warn({ userId }, '[SyncWorker] syncGarminLatest blocked during verification mode');
    return;
  }

  const accessToken = await getValidGarminToken(userId);

  if (!accessToken) {
    throw new Error('No valid Garmin token available');
  }

  // Fetch activities from the last 30 days
  const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
  const now = Math.floor(Date.now() / 1000);

  const url = `${config.garminApiBase}/rest/activities?uploadStartTimeInSeconds=${thirtyDaysAgo}&uploadEndTimeInSeconds=${now}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Garmin API error: ${response.status} ${text}`);
  }

  const activities = (await response.json()) as GarminActivity[];
  console.log(`[SyncWorker] Fetched ${activities.length} Garmin activities`);

  // Filter to cycling activities
  const cyclingActivities = activities.filter((a) => {
    const typeLower = a.activityType.toLowerCase().replace(/\s+/g, '_');
    return GARMIN_CYCLING_TYPES.includes(typeLower);
  });

  console.log(`[SyncWorker] Processing ${cyclingActivities.length} cycling activities`);

  for (const activity of cyclingActivities) {
    await upsertGarminActivity(userId, activity);
  }

  console.log(`[SyncWorker] Garmin sync complete for user ${userId}`);
}

async function syncGarminActivity(userId: string, activityId: string): Promise<void> {
  logger.info({
    event: 'garmin_pull_start',
    userId,
    activityId,
  }, '[SyncWorker] Starting Garmin activity pull');

  const accessToken = await getValidGarminToken(userId);

  if (!accessToken) {
    logger.error({
      event: 'garmin_pull_error',
      userId,
      activityId,
      error: 'no_valid_token',
    }, '[SyncWorker] No valid Garmin token');
    throw new Error('No valid Garmin token available');
  }

  try {
    const response = await fetch(
      `${config.garminApiBase}/rest/activityFile/${activityId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      }
    );

    if (!response.ok) {
      const text = await response.text();
      logger.error({
        event: 'garmin_pull_error',
        userId,
        activityId,
        status: response.status,
        response: text,
      }, '[SyncWorker] Garmin API error');
      throw new Error(`Garmin API error: ${response.status} ${text}`);
    }

    const activity = (await response.json()) as GarminActivity;
    const typeLower = activity.activityType.toLowerCase().replace(/\s+/g, '_');

    if (!GARMIN_CYCLING_TYPES.includes(typeLower)) {
      logger.debug({
        activityId,
        activityType: activity.activityType,
      }, '[SyncWorker] Skipping non-cycling activity');
      return;
    }

    await upsertGarminActivity(userId, activity);

    logger.info({
      event: 'garmin_pull_success',
      userId,
      activityId,
      activityType: activity.activityType,
    }, '[SyncWorker] Garmin activity pull complete');
  } catch (error) {
    logger.error({
      event: 'garmin_pull_error',
      userId,
      activityId,
      error: error instanceof Error ? error.message : String(error),
    }, '[SyncWorker] Garmin activity pull failed');
    throw error;
  }
}

async function upsertGarminActivity(userId: string, activity: GarminActivity): Promise<void> {
  const distanceMiles = activity.distanceInMeters
    ? activity.distanceInMeters * 0.000621371
    : 0;

  const elevationGainFeet =
    (activity.totalElevationGainInMeters ?? activity.elevationGainInMeters)
      ? (activity.totalElevationGainInMeters ?? activity.elevationGainInMeters)! * 3.28084
      : 0;

  const startTime = new Date(activity.startTimeInSeconds * 1000);

  // Use async version for reverse geocoding (matching webhook behavior)
  const autoLocation = await deriveLocationAsync({
    city: activity.locationName ?? null,
    state: null,
    country: null,
    lat: activity.startLatitudeInDegrees ?? activity.beginLatitude ?? null,
    lon: activity.startLongitudeInDegrees ?? activity.beginLongitude ?? null,
  });

  const existing = await prisma.ride.findUnique({
    where: { garminActivityId: activity.summaryId },
    select: { location: true },
  });

  const locationUpdate = shouldApplyAutoLocation(existing?.location ?? null, autoLocation?.title ?? null);

  // Look up running ImportSession for this user (if any)
  const runningSession = await prisma.importSession.findFirst({
    where: { userId, provider: 'garmin', status: 'running' },
    select: { id: true },
  });

  await prisma.ride.upsert({
    where: { garminActivityId: activity.summaryId },
    create: {
      userId,
      garminActivityId: activity.summaryId,
      startTime,
      durationSeconds: activity.durationInSeconds,
      distanceMiles,
      elevationGainFeet,
      averageHr: activity.averageHeartRateInBeatsPerMinute ?? null,
      rideType: activity.activityType,
      notes: activity.activityName ?? null,
      location: autoLocation?.title ?? null,
      importSessionId: runningSession?.id ?? null,
    },
    update: {
      startTime,
      durationSeconds: activity.durationInSeconds,
      distanceMiles,
      elevationGainFeet,
      averageHr: activity.averageHeartRateInBeatsPerMinute ?? null,
      rideType: activity.activityType,
      notes: activity.activityName ?? null,
      ...(locationUpdate !== undefined ? { location: locationUpdate } : {}),
    },
  });

  // Update session's lastActivityReceivedAt if there's a running session
  if (runningSession) {
    await prisma.importSession.update({
      where: { id: runningSession.id },
      data: { lastActivityReceivedAt: new Date() },
    });
  }

  logger.debug({ summaryId: activity.summaryId }, '[SyncWorker] Upserted Garmin activity');
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const secondsToHours = (seconds: number | null | undefined) =>
  Math.max(0, seconds ?? 0) / 3600;

async function syncBikeComponentHours(
  tx: Prisma.TransactionClient,
  userId: string,
  previous: { bikeId: string | null; durationSeconds: number | null | undefined },
  next: { bikeId: string | null; durationSeconds: number | null | undefined }
): Promise<void> {
  const prevBikeId = previous.bikeId;
  const nextBikeId = next.bikeId;
  const prevHours = secondsToHours(previous.durationSeconds);
  const nextHours = secondsToHours(next.durationSeconds);
  const bikeChanged = prevBikeId !== nextBikeId;
  const hoursDiff = nextHours - prevHours;

  if (prevBikeId) {
    if (bikeChanged && prevHours > 0) {
      await tx.component.updateMany({
        where: { userId, bikeId: prevBikeId },
        data: { hoursUsed: { decrement: prevHours } },
      });
    } else if (!bikeChanged && hoursDiff < 0) {
      await tx.component.updateMany({
        where: { userId, bikeId: prevBikeId },
        data: { hoursUsed: { decrement: Math.abs(hoursDiff) } },
      });
    }

    if (bikeChanged || hoursDiff < 0) {
      await tx.component.updateMany({
        where: { userId, bikeId: prevBikeId, hoursUsed: { lt: 0 } },
        data: { hoursUsed: 0 },
      });
    }
  }

  if (nextBikeId) {
    if (bikeChanged && nextHours > 0) {
      await tx.component.updateMany({
        where: { userId, bikeId: nextBikeId },
        data: { hoursUsed: { increment: nextHours } },
      });
    } else if (!bikeChanged && hoursDiff > 0) {
      await tx.component.updateMany({
        where: { userId, bikeId: nextBikeId },
        data: { hoursUsed: { increment: hoursDiff } },
      });
    }
  }
}

// ============================================================================
// WORKER SINGLETON
// ============================================================================

let syncWorker: Worker<SyncJobData, void, SyncJobName> | null = null;

/**
 * Create and start the sync worker.
 */
export function createSyncWorker(): Worker<SyncJobData, void, SyncJobName> {
  if (syncWorker) {
    return syncWorker;
  }

  syncWorker = new Worker<SyncJobData, void, SyncJobName>(
    'sync',
    processSyncJob,
    {
      connection: getQueueConnection(),
      concurrency: 1, // Single user app - sequential processing is sufficient
      // Reduce polling frequency when idle to lower Redis costs
      drainDelay: 5000, // Wait 5s between empty polls (default 0)
    }
  );

  syncWorker.on('completed', (job) => {
    console.log(`[SyncWorker] Job ${job.id} (${job.name}) completed`);
  });

  syncWorker.on('failed', (job, err) => {
    console.error(`[SyncWorker] Job ${job?.id} (${job?.name}) failed:`, err.message);
  });

  syncWorker.on('error', (err) => {
    console.error('[SyncWorker] Worker error:', err.message);
  });

  console.log('[SyncWorker] Started');
  return syncWorker;
}

/**
 * Stop and close the sync worker.
 */
export async function closeSyncWorker(): Promise<void> {
  if (syncWorker) {
    await syncWorker.close();
    syncWorker = null;
    console.log('[SyncWorker] Stopped');
  }
}
