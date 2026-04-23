import '../instrument'; // Ensure Sentry is initialized even if worker runs in a separate process
import { Worker, Job } from 'bullmq';
import * as Sentry from '@sentry/node';
import { getQueueConnection } from '../lib/queue/connection';
import { acquireLock, releaseLock } from '../lib/rate-limit';
import { prisma } from '../lib/prisma';
import { getValidGarminToken } from '../lib/garmin-token';
import { getValidSuuntoToken } from '../lib/suunto-token';
import { deriveLocationAsync, shouldApplyAutoLocation } from '../lib/location';
import { logError, logger } from '../lib/logger';
import { config } from '../config/env';
import type { BackfillJobData, BackfillJobName } from '../lib/queue/backfill.queue';
import { enqueueWeatherJob } from '../lib/queue';
import { captureServerEvent } from '../lib/posthog';
import { incrementBikeComponentHours, syncBikeComponentHours } from '../lib/component-hours';
import { isSuuntoCyclingActivity, getSuuntoRideType } from '../types/suunto';
import {
  SUUNTO_API_BASE,
  suuntoApiHeaders,
  type SuuntoWorkout,
  type SuuntoWorkoutsResponse,
} from '../lib/suunto-sync';
import { findPotentialDuplicates, type DuplicateCandidate } from '../lib/duplicate-detector';

// Garmin API limits backfill requests to 30-day chunks
const CHUNK_DAYS = 30;

// Minimum year for backfill requests (Garmin Connect launched in 2008,
// but most meaningful cycling data starts later; 2000 provides headroom)
const MIN_BACKFILL_YEAR = 2000;

// Cycling activity types for Garmin (used in callback processing)
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

// Garmin activity type from callback URL response
type GarminActivityDetail = {
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
 * Process a backfill job.
 * Handles both backfillYear (triggers Garmin API) and processCallback (processes callback URL).
 */
async function processBackfillJob(job: Job<BackfillJobData, void, BackfillJobName>): Promise<void> {
  const { userId, provider, year, callbackURL } = job.data;

  // Handle processCallback job type
  if (job.name === 'processCallback' && callbackURL) {
    logger.info({
      event: 'garmin_callback_start',
      userId,
      jobId: job.id,
    }, '[BackfillWorker] Processing callback job');

    await processGarminCallback(userId, callbackURL);
    return;
  }

  // Handle backfillYear job type
  if (!year) {
    throw new Error('backfillYear job requires year field');
  }

  logger.info({ provider, year, userId, jobId: job.id }, 'Processing backfill job');

  // Update status to in_progress
  await prisma.backfillRequest.updateMany({
    where: {
      userId,
      provider,
      year,
      status: { not: 'completed' },
    },
    data: { status: 'in_progress', updatedAt: new Date() },
  });

  // Acquire distributed lock to prevent concurrent backfills for the same user/provider
  const lockResult = await acquireLock('backfill', provider, userId);

  if (!lockResult.acquired) {
    logger.debug({ provider, userId }, 'Backfill lock not available, will retry');
    throw new Error('Lock not available, will retry');
  }

  try {
    if (provider === 'garmin') {
      await processGarminBackfill(userId, year);
    } else if (provider === 'suunto') {
      await processSuuntoBackfill(userId, year);
    } else {
      throw new Error(`Unsupported provider for backfill: ${provider}`);
    }

    logger.info({ provider, year }, 'Backfill job completed');
  } catch (error) {
    logError(`BackfillWorker ${provider}/${year}`, error);

    // Mark as failed
    await prisma.backfillRequest.updateMany({
      where: { userId, provider, year },
      data: { status: 'failed', updatedAt: new Date() },
    });

    throw error; // Re-throw for BullMQ retry logic
  } finally {
    await releaseLock(lockResult.lockKey, lockResult.lockValue);
    logger.debug({ provider, userId }, 'Backfill lock released');
  }
}

/**
 * Process Garmin backfill for a specific year.
 * Triggers the Garmin Wellness API backfill endpoint in 30-day chunks.
 * Activities are delivered asynchronously via webhooks.
 */
async function processGarminBackfill(userId: string, year: string): Promise<void> {
  const accessToken = await getValidGarminToken(userId);

  if (!accessToken) {
    throw new Error('Garmin token expired or not connected');
  }

  // Calculate date range
  const currentYear = new Date().getFullYear();
  let startDate: Date;
  let endDate: Date;

  if (year === 'ytd') {
    // Check for existing YTD backfill to enable incremental fetching
    const existingYtd = await prisma.backfillRequest.findUnique({
      where: { userId_provider_year: { userId, provider: 'garmin', year: 'ytd' } },
    });

    if (existingYtd?.backfilledUpTo && existingYtd.status === 'in_progress') {
      // Only use incremental logic if we have a previous completed backfill
      // Since we just set status to in_progress, check if backfilledUpTo exists
      // If it does, it means a previous backfill completed and we should continue from there
      const previousEndDate = existingYtd.backfilledUpTo;
      startDate = new Date(previousEndDate.getTime() + 1000);
    } else {
      startDate = new Date(currentYear, 0, 1); // Jan 1 00:00:00
    }
    endDate = new Date(); // Now
  } else {
    const yearNum = parseInt(year, 10);
    if (isNaN(yearNum) || yearNum < MIN_BACKFILL_YEAR || yearNum > currentYear) {
      throw new Error(
        `Invalid year: ${year}. Must be a number between ${MIN_BACKFILL_YEAR} and ${currentYear}, or "ytd".`
      );
    }
    startDate = new Date(yearNum, 0, 1); // Jan 1 00:00:00
    endDate = new Date(yearNum, 11, 31, 23, 59, 59); // Dec 31 23:59:59
  }

  logger.info(
    { startDate: startDate.toISOString(), endDate: endDate.toISOString(), year },
    'Garmin backfill date range'
  );

  // Trigger backfill in 30-day chunks
  let currentStartDate = new Date(startDate);
  let totalChunks = 0;
  let duplicateChunks = 0;
  const errors: string[] = [];

  while (currentStartDate < endDate) {
    const chunkEndDate = new Date(currentStartDate);
    chunkEndDate.setDate(chunkEndDate.getDate() + CHUNK_DAYS);
    const actualChunkEndDate = chunkEndDate > endDate ? endDate : chunkEndDate;

    const chunkStartSeconds = Math.floor(currentStartDate.getTime() / 1000);
    const chunkEndSeconds = Math.floor(actualChunkEndDate.getTime() / 1000);

    logger.debug(
      { chunkStart: currentStartDate.toISOString(), chunkEnd: actualChunkEndDate.toISOString() },
      'Triggering Garmin backfill chunk'
    );

    const url = `${config.garminApiBase}/rest/backfill/activities?summaryStartTimeInSeconds=${chunkStartSeconds}&summaryEndTimeInSeconds=${chunkEndSeconds}`;

    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
      });

      if (response.status === 202) {
        totalChunks++;
        logger.info({ chunk: totalChunks }, 'Garmin backfill chunk accepted');
      } else if (response.status === 409) {
        // Duplicate request - backfill already done for this date range
        duplicateChunks++;
        logger.warn(
          { startDate: currentStartDate.toISOString().split('T')[0] },
          'Garmin backfill chunk already completed (409)'
        );
      } else if (response.status === 400) {
        const text = await response.text();
        const minStartDate = extractMinStartDate(text);
        if (minStartDate && minStartDate > currentStartDate) {
          logger.warn(
            { originalStart: currentStartDate.toISOString(), adjustedStart: minStartDate.toISOString() },
            'Adjusting to Garmin minimum start date'
          );
          currentStartDate = new Date(Math.ceil(minStartDate.getTime() / 1000) * 1000);
          continue;
        }
        logger.error({ status: response.status, response: text }, 'Garmin backfill chunk failed');
        errors.push(`Failed for ${currentStartDate.toISOString().split('T')[0]}: ${response.status}`);
      } else {
        const text = await response.text();
        logger.error({ status: response.status, response: text }, 'Garmin backfill chunk failed');
        errors.push(`Failed for ${currentStartDate.toISOString().split('T')[0]}: ${response.status}`);
      }
    } catch (error) {
      logError('BackfillWorker chunk', error);
      errors.push(`Error for ${currentStartDate.toISOString().split('T')[0]}`);
    }

    currentStartDate = new Date(actualChunkEndDate);
  }

  logger.info(
    { totalChunks, duplicateChunks, year },
    'Garmin backfill chunks processed'
  );

  // Check if ALL chunks returned 409 - means backfill was already completed
  const allDuplicates = duplicateChunks > 0 && totalChunks === 0 && errors.length === 0;

  if (allDuplicates) {
    // All chunks returned 409 - backfill was already done for entire date range
    logger.warn(
      { userId, year, duplicateChunks },
      'Garmin backfill already completed for entire date range'
    );

    // Mark as completed since the data was already fetched
    await prisma.backfillRequest.updateMany({
      where: { userId, provider: 'garmin', year },
      data: { status: 'completed', updatedAt: new Date() },
    });

    return; // Success - backfill was already done
  }

  // Update backfilledUpTo for YTD
  if (year === 'ytd') {
    await prisma.backfillRequest.updateMany({
      where: { userId, provider: 'garmin', year },
      data: { backfilledUpTo: endDate, updatedAt: new Date() },
    });
  }

  // If no chunks were triggered and we had errors, fail the job
  if (totalChunks === 0 && errors.length > 0) {
    throw new Error(`Failed to trigger any backfill chunks: ${errors.join(', ')}`);
  }

  // Note: Status will be updated to 'completed' by the webhook handler
  // when all activities have been delivered
}

// ============================================================================
// SUUNTO BACKFILL
// ============================================================================

const SUUNTO_PAGE_LIMIT = 100;
const SUUNTO_MAX_PAGES = 100;
const SUUNTO_MIN_BACKFILL_YEAR = 2015;

/**
 * Process Suunto backfill for a specific year.
 *
 * Unlike Garmin, Suunto has no webhook-driven backfill mechanism. We page
 * through GET /v3/workouts synchronously and upsert cycling rides directly.
 * Cross-provider duplicate detection skips rides that already exist from
 * Garmin/Strava/WHOOP on the same day.
 */
async function processSuuntoBackfill(userId: string, year: string): Promise<void> {
  const accessToken = await getValidSuuntoToken(userId);

  if (!accessToken) {
    throw new Error('Suunto token expired or not connected');
  }

  const currentYear = new Date().getFullYear();
  let startDate: Date;
  let endDate: Date;

  if (year === 'ytd') {
    const existingYtd = await prisma.backfillRequest.findUnique({
      where: { userId_provider_year: { userId, provider: 'suunto', year: 'ytd' } },
    });

    // Resume YTD from the last checkpoint if there is one. Note: status was
    // already flipped to in_progress before we got here, so we rely solely on
    // backfilledUpTo to tell us whether a prior run left us a checkpoint.
    if (existingYtd?.backfilledUpTo) {
      startDate = new Date(existingYtd.backfilledUpTo.getTime() + 1000);
    } else {
      startDate = new Date(currentYear, 0, 1);
    }
    endDate = new Date();
  } else {
    const yearNum = parseInt(year, 10);
    if (isNaN(yearNum) || yearNum < SUUNTO_MIN_BACKFILL_YEAR || yearNum > currentYear) {
      throw new Error(
        `Invalid year: ${year}. Must be between ${SUUNTO_MIN_BACKFILL_YEAR} and ${currentYear}, or "ytd".`
      );
    }
    startDate = new Date(yearNum, 0, 1);
    endDate = new Date(yearNum, 11, 31, 23, 59, 59);
  }

  if (startDate >= endDate) {
    logger.info({ userId, year }, '[BackfillWorker] Suunto backfill already up to date');
    await prisma.backfillRequest.updateMany({
      where: { userId, provider: 'suunto', year },
      data: { status: 'completed', completedAt: new Date(), updatedAt: new Date() },
    });
    return;
  }

  logger.info(
    { userId, year, startDate: startDate.toISOString(), endDate: endDate.toISOString() },
    '[BackfillWorker] Starting Suunto backfill'
  );

  const workouts: SuuntoWorkout[] = [];
  let offset = 0;
  let pageCount = 0;

  while (pageCount < SUUNTO_MAX_PAGES) {
    const url = new URL(`${SUUNTO_API_BASE}/workouts`);
    url.searchParams.set('since', String(startDate.getTime()));
    url.searchParams.set('until', String(endDate.getTime()));
    url.searchParams.set('limit', String(SUUNTO_PAGE_LIMIT));
    url.searchParams.set('offset', String(offset));

    const apiRes = await fetch(url.toString(), {
      headers: suuntoApiHeaders(accessToken),
    });

    if (!apiRes.ok) {
      const text = await apiRes.text();
      throw new Error(`Suunto API error: ${apiRes.status} ${text.slice(0, 200)}`);
    }

    const page = (await apiRes.json()) as SuuntoWorkoutsResponse;
    const records = page.payload ?? [];
    workouts.push(...records);
    pageCount++;

    if (records.length < SUUNTO_PAGE_LIMIT) break;
    offset += SUUNTO_PAGE_LIMIT;
  }

  if (pageCount >= SUUNTO_MAX_PAGES) {
    logger.warn(
      { userId, year, totalFetched: workouts.length },
      '[BackfillWorker] Suunto page cap hit; some workouts may be missing'
    );
  }

  const cyclingWorkouts = workouts.filter((w) => isSuuntoCyclingActivity(w.activityId));

  // Auto-assign to the single active bike if the user has exactly one; Suunto
  // has no gear tagging in the workout list so this is our only signal.
  const userBikes = await prisma.bike.findMany({
    where: { userId, status: 'ACTIVE' },
    select: { id: true },
  });
  const autoAssignBikeId = userBikes.length === 1 ? userBikes[0].id : null;

  // Look up running ImportSession so new rides get tagged for progress tracking.
  const runningSession = await prisma.importSession.findFirst({
    where: { userId, provider: 'suunto', status: 'running' },
    select: { id: true },
  });

  let importedCount = 0;
  let skippedCount = 0;
  let duplicatesDetected = 0;

  for (const workout of cyclingWorkouts) {
    // Same-provider dedup via the unique index on suuntoWorkoutId.
    const existing = await prisma.ride.findUnique({
      where: { suuntoWorkoutId: workout.workoutKey },
    });
    if (existing) {
      skippedCount++;
      continue;
    }

    const startTime = new Date(workout.startTime);
    const durationSeconds = workout.totalTime;
    const durationHours = Math.max(0, durationSeconds) / 3600;
    const distanceMeters = workout.totalDistance ?? 0;
    const elevationGainMeters = workout.totalAscent ?? 0;
    const averageHr = workout.hrdata?.workoutAvgHR != null
      ? Math.round(workout.hrdata.workoutAvgHR)
      : null;
    const startLat = workout.startPosition?.y ?? null;
    const startLng = workout.startPosition?.x ?? null;

    // Cross-provider dedup: skip if an overlapping ride already came from
    // Garmin/Strava/WHOOP on the same day.
    const duplicateCandidate: DuplicateCandidate = {
      id: '',
      startTime,
      durationSeconds,
      distanceMeters,
      elevationGainMeters,
      garminActivityId: null,
      stravaActivityId: null,
      whoopWorkoutId: null,
      suuntoWorkoutId: workout.workoutKey,
    };

    const duplicate = await findPotentialDuplicates(userId, duplicateCandidate, prisma);
    if (duplicate) {
      duplicatesDetected++;
      skippedCount++;
      continue;
    }

    let createdRideId: string | null = null;

    await prisma.$transaction(async (tx) => {
      const ride = await tx.ride.create({
        data: {
          userId,
          suuntoWorkoutId: workout.workoutKey,
          startTime,
          durationSeconds,
          distanceMeters,
          elevationGainMeters,
          averageHr,
          rideType: getSuuntoRideType(workout.activityId),
          startLat,
          startLng,
          bikeId: autoAssignBikeId,
          importSessionId: runningSession?.id ?? null,
        },
        select: { id: true },
      });

      createdRideId = ride.id;

      if (autoAssignBikeId) {
        await incrementBikeComponentHours(tx, {
          userId,
          bikeId: autoAssignBikeId,
          hoursDelta: durationHours,
        });
      }
    });

    importedCount++;

    // Fire-and-forget weather fetch so the ride gets enriched later without
    // blocking the backfill loop.
    if (createdRideId && startLat != null && startLng != null) {
      enqueueWeatherJob({ rideId: createdRideId }).catch((err) =>
        logger.warn({ rideId: createdRideId, err }, '[BackfillWorker] Failed to enqueue weather job (Suunto)')
      );
    }
  }

  // Update session's lastActivityReceivedAt if any rides were created, so the
  // idle-session checker doesn't prematurely close the import.
  if (runningSession && importedCount > 0) {
    await prisma.importSession.update({
      where: { id: runningSession.id },
      data: { lastActivityReceivedAt: new Date() },
    });
  }

  // Increment rather than overwrite so the cumulative count survives
  // re-runs (e.g. YTD backfill called multiple times to pick up new
  // workouts since the last checkpoint). Matches the synchronous
  // /suunto/backfill/fetch endpoint's behavior.
  await prisma.backfillRequest.updateMany({
    where: { userId, provider: 'suunto', year },
    data: {
      status: 'completed',
      ridesFound: { increment: importedCount },
      backfilledUpTo: endDate,
      completedAt: new Date(),
      updatedAt: new Date(),
    },
  });

  logger.info(
    { userId, year, imported: importedCount, skipped: skippedCount, duplicatesDetected },
    '[BackfillWorker] Suunto backfill complete'
  );
}

/**
 * Process a Garmin callback URL (used for backfill webhook responses).
 * Fetches activities from the callback URL and upserts them.
 */
async function processGarminCallback(userId: string, callbackURL: string): Promise<void> {
  const accessToken = await getValidGarminToken(userId);

  if (!accessToken) {
    logger.error({
      event: 'garmin_callback_error',
      userId,
      error: 'no_valid_token',
    }, '[BackfillWorker] No valid Garmin token for callback');
    throw new Error('Garmin token expired or not connected');
  }

  logger.info({
    event: 'garmin_callback_fetch_start',
    userId,
  }, '[BackfillWorker] Fetching from Garmin callback URL');

  // Fetch activities from the callback URL
  const callbackRes = await fetch(callbackURL, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    },
  });

  if (!callbackRes.ok) {
    const text = await callbackRes.text();
    logger.error({
      event: 'garmin_callback_error',
      userId,
      status: callbackRes.status,
      response: text,
    }, '[BackfillWorker] Failed to fetch from callback URL');
    throw new Error(`Garmin callback fetch failed: ${callbackRes.status}`);
  }

  const activities = (await callbackRes.json()) as GarminActivityDetail[];

  if (!Array.isArray(activities)) {
    logger.error({
      event: 'garmin_callback_error',
      userId,
      response: activities,
    }, '[BackfillWorker] Unexpected response format from callback URL');
    throw new Error('Unexpected response format from callback URL');
  }

  logger.info({
    event: 'garmin_callback_activities_fetched',
    userId,
    count: activities.length,
  }, '[BackfillWorker] Fetched activities from callback URL');

  // Look up running ImportSession for this user once before processing the batch
  const runningSession = await prisma.importSession.findFirst({
    where: { userId, provider: 'garmin', status: 'running' },
    select: { id: true },
  });

  let processedActivityCount = 0;

  for (const activity of activities) {
    const activityTypeLower = activity.activityType.toLowerCase().replace(/\s+/g, '_');
    if (!GARMIN_CYCLING_TYPES.includes(activityTypeLower)) {
      logger.debug({
        activityType: activity.activityType,
        summaryId: activity.summaryId,
      }, '[BackfillWorker] Skipping non-cycling activity');
      continue;
    }

    // Convert activity to Ride format
    const distanceMeters = activity.distanceInMeters ?? 0;

    const elevationGainMeters =
      (activity.totalElevationGainInMeters ?? activity.elevationGainInMeters) ?? 0;

    const startTime = new Date(activity.startTimeInSeconds * 1000);

    const autoLocation = await deriveLocationAsync({
      city: activity.locationName ?? null,
      state: null,
      country: null,
      lat: activity.startLatitudeInDegrees ?? activity.beginLatitude ?? null,
      lon: activity.startLongitudeInDegrees ?? activity.beginLongitude ?? null,
    });

    const existingRide = await prisma.ride.findUnique({
      where: { garminActivityId: activity.summaryId },
      select: { location: true, bikeId: true, durationSeconds: true },
    });

    const locationUpdate = shouldApplyAutoLocation(
      existingRide?.location ?? null,
      autoLocation?.title ?? null
    );

    const startLat = activity.startLatitudeInDegrees ?? activity.beginLatitude ?? null;
    const startLng = activity.startLongitudeInDegrees ?? activity.beginLongitude ?? null;

    // Upsert the ride + sync component hours together so callback-delivered
    // rides match the behavior of webhook-delivered ones (see sync.worker.ts
    // `upsertGarminActivity`). Missing this was why Garmin backfill-imported
    // rides didn't accrue component wear.
    const upsertedRide = await prisma.$transaction(async (tx) => {
      const ride = await tx.ride.upsert({
        where: { garminActivityId: activity.summaryId },
        create: {
          userId,
          garminActivityId: activity.summaryId,
          startTime,
          durationSeconds: activity.durationInSeconds,
          distanceMeters,
          elevationGainMeters,
          averageHr: activity.averageHeartRateInBeatsPerMinute ?? null,
          rideType: activity.activityType,
          notes: activity.activityName ?? null,
          location: autoLocation?.title ?? null,
          importSessionId: runningSession?.id ?? null,
          startLat,
          startLng,
        },
        update: {
          startTime,
          durationSeconds: activity.durationInSeconds,
          distanceMeters,
          elevationGainMeters,
          averageHr: activity.averageHeartRateInBeatsPerMinute ?? null,
          rideType: activity.activityType,
          notes: activity.activityName ?? null,
          ...(locationUpdate !== undefined ? { location: locationUpdate } : {}),
          // Known limitation: coords are only written, never cleared on
          // re-sync. See sync.worker.ts for full rationale.
          ...(startLat != null ? { startLat } : {}),
          ...(startLng != null ? { startLng } : {}),
        },
        select: { id: true, bikeId: true, durationSeconds: true },
      });

      await syncBikeComponentHours(
        tx,
        userId,
        { bikeId: existingRide?.bikeId ?? null, durationSeconds: existingRide?.durationSeconds ?? null },
        { bikeId: ride.bikeId ?? null, durationSeconds: ride.durationSeconds }
      );

      return ride;
    });

    if (startLat != null && startLng != null) {
      enqueueWeatherJob({ rideId: upsertedRide.id }).catch((err) =>
        logger.warn({ rideId: upsertedRide.id, err }, '[BackfillWorker] Failed to enqueue weather job')
      );
    }

    processedActivityCount++;
    logger.debug({ summaryId: activity.summaryId }, '[BackfillWorker] Upserted ride from callback');
  }

  // Update session's lastActivityReceivedAt once after processing the batch
  if (runningSession && processedActivityCount > 0) {
    await prisma.importSession.update({
      where: { id: runningSession.id },
      data: { lastActivityReceivedAt: new Date() },
    });
  }

  logger.info({
    event: 'garmin_callback_success',
    userId,
    processedCount: processedActivityCount,
    totalCount: activities.length,
  }, '[BackfillWorker] Callback processing complete');
}

/**
 * Extracts minimum start date from Garmin API 400 error response.
 */
function extractMinStartDate(errorText: string): Date | null {
  try {
    const parsed = JSON.parse(errorText);
    const message =
      typeof parsed?.errorMessage === 'string' ? parsed.errorMessage : String(parsed ?? '');
    const match = message.match(/min start time of ([0-9T:.-]+Z)/i);
    if (match && match[1]) {
      const dt = new Date(match[1]);
      if (!Number.isNaN(dt.getTime())) {
        return dt;
      }
    }
  } catch {
    // ignore JSON parse errors
  }
  return null;
}

// ============================================================================
// WORKER SINGLETON
// ============================================================================

let backfillWorker: Worker<BackfillJobData, void, BackfillJobName> | null = null;

/**
 * Create and start the backfill worker.
 */
export function createBackfillWorker(): Worker<BackfillJobData, void, BackfillJobName> {
  if (backfillWorker) {
    return backfillWorker;
  }

  backfillWorker = new Worker<BackfillJobData, void, BackfillJobName>(
    'backfill',
    processBackfillJob,
    {
      connection: getQueueConnection(),
      concurrency: 5, // Process up to 5 backfills concurrently
      drainDelay: 10000, // Wait 10s between empty polls
    }
  );

  backfillWorker.on('completed', (job) => {
    logger.info({ jobId: job.id, jobName: job.name, year: job.data.year }, 'Backfill job completed');
    const { userId, provider, year } = job.data;
    if (userId) {
      captureServerEvent(userId, 'provider_backfill_completed', {
        provider,
        year,
        jobName: job.name,
      });
    }
  });

  backfillWorker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, jobName: job?.name, year: job?.data.year, error: err.message },
      'Backfill job failed'
    );
    Sentry.captureException(err, { tags: { worker: 'backfill', jobName: job?.name }, extra: { jobId: job?.id } });
  });

  backfillWorker.on('error', (err) => {
    logger.error({ error: err.message }, 'BackfillWorker error');
    Sentry.captureException(err, { tags: { worker: 'backfill' } });
  });

  logger.info('BackfillWorker started');
  return backfillWorker;
}

/**
 * Stop and close the backfill worker.
 */
export async function closeBackfillWorker(): Promise<void> {
  if (backfillWorker) {
    await backfillWorker.close();
    backfillWorker = null;
    logger.info('BackfillWorker stopped');
  }
}
