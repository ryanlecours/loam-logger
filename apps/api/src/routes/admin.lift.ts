import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAdmin } from '../auth/adminMiddleware';
import {
  sendSuccess,
  sendBadRequest,
  sendNotFound,
  sendInternalError,
  sendTooManyRequests,
} from '../lib/api-response';
import { checkAdminRateLimit } from '../lib/rate-limit';
import { enqueueLiftDetectionJob, getLiftQueue } from '../lib/queue';
import { logError } from '../lib/logger';

// Lift-detection validation surface (docs/plans/lift-detection-plan.md §5,
// increment 3). Read-only report over shadow-mode results, plus the admin/dev
// form of the analyze trigger used to seed known historical park rides into
// the validation set. Nothing here changes user-visible metrics.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_REPORT_LIMIT = 50;
const MAX_REPORT_LIMIT = 200;
// Lift jobs run at concurrency 2 and each reuses a stored stream, so a
// thousand is a few minutes of background work, not a flood.
const DEFAULT_BACKFILL_LIMIT = 200;
const MAX_BACKFILL_LIMIT = 1000;
// Re-analysis calls Overpass for every cell a ride covers that is not cached,
// so its batches are small: see the pacing note on POST /reanalyze.
const DEFAULT_REANALYZE_LIMIT = 50;
const MAX_REANALYZE_LIMIT = 200;

const REANALYZE_SCOPES = ['degraded', 'all', 'pending'] as const;
type ReanalyzeScope = (typeof REANALYZE_SCOPES)[number];

type BatchParams = { limit: number; before?: Date; beforeId?: string };

/**
 * Batch size and (start time, id) cursor shared by the batch routes below.
 * Returns an error message instead of a result for a malformed cursor, so the
 * caller can reject it before spending the cooldown: a typo should not cost a
 * minute.
 */
function parseBatchParams(
  body: Record<string, unknown> | undefined,
  defaultLimit: number,
  maxLimit: number
): BatchParams | { error: string } {
  const limitRaw = body?.limit;
  const limit =
    typeof limitRaw === 'number' && Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.trunc(limitRaw), 1), maxLimit)
      : defaultLimit;

  let before: Date | undefined;
  if (body?.before !== undefined) {
    before = new Date(String(body.before));
    if (Number.isNaN(before.getTime())) {
      return { error: 'Invalid before date' };
    }
  }
  const beforeId = typeof body?.beforeId === 'string' ? body.beforeId : undefined;
  if (beforeId !== undefined && (!before || !UUID_REGEX.test(beforeId))) {
    return { error: 'beforeId must be a ride id and accompany before' };
  }

  return { limit, before, beforeId };
}

/**
 * Strictly older, or the same instant with a smaller id: the id tie-break is
 * what keeps two rides that share a start time (bulk imports across users)
 * from being split by a batch boundary and lost.
 */
function cursorWhere(before?: Date, beforeId?: string) {
  if (!before) return {};
  return beforeId
    ? { OR: [{ startTime: { lt: before } }, { startTime: before, id: { lt: beforeId } }] }
    : { startTime: { lt: before } };
}

/** The cursor for the next batch, or null once a batch comes back short. */
function nextCursor(rides: Array<{ id: string; startTime: Date }>, limit: number) {
  const last = rides[rides.length - 1];
  return rides.length === limit && last
    ? { before: last.startTime.toISOString(), beforeId: last.id }
    : null;
}

const router = Router();

router.use(requireAdmin);

/**
 * GET /api/admin/lift/report
 * Shadow-mode detection results for validation: summary counts plus per-ride
 * rows with segments, scores, and deltas.
 *
 * Query params:
 *   limit            max rides returned (default 50, cap 200)
 *   since            ISO date; only rides starting on/after it
 *   withSegmentsOnly 'true' to list only rides where lifts were detected
 */
router.get('/report', async (req, res) => {
  try {
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.trunc(limitRaw), 1), MAX_REPORT_LIMIT)
      : DEFAULT_REPORT_LIMIT;

    let since: Date | undefined;
    if (req.query.since !== undefined) {
      since = new Date(String(req.query.since));
      if (Number.isNaN(since.getTime())) {
        return sendBadRequest(res, 'Invalid since date');
      }
    }

    const withSegmentsOnly = req.query.withSegmentsOnly === 'true';

    const analyzedWhere = {
      liftDetectorVersion: { not: null },
      ...(since ? { startTime: { gte: since } } : {}),
    };

    const [analyzedCount, withLiftCount, streamCount, pendingCount, rides] = await Promise.all([
      prisma.ride.count({ where: analyzedWhere }),
      prisma.ride.count({ where: { ...analyzedWhere, liftDurationSeconds: { gt: 0 } } }),
      prisma.rideStream.count(),
      // Stream persisted but never analyzed (e.g. missing altitude, or a
      // detector-version bump re-queued them).
      prisma.ride.count({ where: { stream: { isNot: null }, liftDetectorVersion: null } }),
      prisma.ride.findMany({
        where: {
          ...analyzedWhere,
          ...(withSegmentsOnly ? { segments: { some: {} } } : {}),
        },
        orderBy: { startTime: 'desc' },
        take: limit,
        select: {
          id: true,
          startTime: true,
          location: true,
          rideType: true,
          durationSeconds: true,
          distanceMeters: true,
          elevationGainMeters: true,
          liftDurationSeconds: true,
          liftElevationGainMeters: true,
          liftDistanceMeters: true,
          liftDetectorVersion: true,
          user: { select: { email: true } },
          segments: {
            orderBy: { startTime: 'asc' },
            select: {
              id: true,
              kind: true,
              startTime: true,
              endTime: true,
              durationSeconds: true,
              elevationGainMeters: true,
              distanceMeters: true,
              confidence: true,
              kinematicScore: true,
              geometryScore: true,
              liftName: true,
              liftOsmId: true,
              detectorVersion: true,
            },
          },
        },
      }),
    ]);

    return sendSuccess(res, {
      summary: {
        analyzedCount,
        withLiftCount,
        streamCount,
        pendingCount,
      },
      rides: rides.map((ride) => ({
        rideId: ride.id,
        userEmail: ride.user.email,
        startTime: ride.startTime.toISOString(),
        location: ride.location,
        rideType: ride.rideType,
        raw: {
          durationSeconds: ride.durationSeconds,
          distanceMeters: ride.distanceMeters,
          elevationGainMeters: ride.elevationGainMeters,
        },
        liftDeltas: {
          durationSeconds: ride.liftDurationSeconds,
          elevationGainMeters: ride.liftElevationGainMeters,
          distanceMeters: ride.liftDistanceMeters,
        },
        detectorVersion: ride.liftDetectorVersion,
        // The validation check is lap count: segments.length vs laps the
        // rider remembers doing.
        segmentCount: ride.segments.length,
        segments: ride.segments.map((seg) => ({
          ...seg,
          startTime: seg.startTime.toISOString(),
          endTime: seg.endTime.toISOString(),
        })),
      })),
    });
  } catch (error) {
    logError('Admin lift report', error);
    return sendInternalError(res, 'Failed to build lift report');
  }
});

/**
 * POST /api/admin/lift/analyze/:rideId
 * Enqueue lift analysis for one ride — the admin/dev form of the
 * mark-bike-park-ride path, used to seed known park rides for validation.
 * Body: {
 *   force?: boolean           re-analyze even if already at the current
 *                             detector version (clears the version so the
 *                             worker reruns)
 *   requireGeometry?: boolean fail the job instead of storing a
 *                             kinematic-only result while Overpass is down
 * }
 */
router.post('/analyze/:rideId', async (req, res) => {
  try {
    const { rideId } = req.params;
    if (!UUID_REGEX.test(rideId)) {
      return sendBadRequest(res, 'Invalid ride id');
    }

    const rateLimit = await checkAdminRateLimit('liftAnalyze', rideId);
    if (!rateLimit.allowed) {
      return sendTooManyRequests(res, 'Analysis recently requested for this ride', rateLimit.retryAfter);
    }

    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
      select: {
        id: true,
        stravaActivityId: true,
        startLat: true,
        startLng: true,
        liftDetectorVersion: true,
        stream: { select: { id: true } },
      },
    });

    if (!ride) {
      return sendNotFound(res, 'Ride not found');
    }
    // The worker reuses a stored stream whatever wrote it (Strava, Garmin
    // ingest, an in-app recording) and only fetches when none is stored, which
    // it can do for Strava alone. So the one ride it cannot analyze from here
    // is one with neither.
    if (!ride.stream && !ride.stravaActivityId) {
      return sendBadRequest(res, 'Ride has no stored stream and is not Strava-sourced; nothing to analyze');
    }
    if (ride.startLat == null || ride.startLng == null) {
      return sendBadRequest(res, 'Ride has no start coordinates');
    }

    if (req.body?.force === true && ride.liftDetectorVersion != null) {
      await prisma.ride.update({
        where: { id: rideId },
        data: { liftDetectorVersion: null },
      });
    }

    const result = await enqueueLiftDetectionJob(
      req.body?.requireGeometry === true ? { rideId, requireGeometry: true } : { rideId }
    );
    return sendSuccess(res, result);
  } catch (error) {
    logError('Admin lift analyze', error);
    return sendInternalError(res, 'Failed to enqueue lift analysis');
  }
});

/**
 * POST /api/admin/lift/backfill-descent
 * Enqueue lift analysis for rides that have a persisted stream but no
 * descent on record, so history fills in without waiting for a re-sync
 * (docs/plans/descent-tracking-plan.md §5). The worker re-runs a ride at
 * the current detector version when its descent is null, so enqueueing is
 * all this needs to do; the stored stream is reused and no provider is
 * called. Rides without a stream (Garmin summaries, WHOOP, Suunto) are
 * counted but cannot be filled from here.
 *
 * Body: {
 *   limit?: number     batch size (default 200, cap 1000)
 *   before?: string    ISO start time; only rides starting at or before it
 *   beforeId?: string  with `before`: the ride id the previous batch ended
 *                      on, so rides sharing that start time are not skipped
 *   dryRun?: boolean   counts only, no enqueue, no cooldown
 * }
 *
 * Paging is by (start time, id), newest first, and the response's
 * nextCursor carries both; pass them back as `before` and `beforeId` to walk
 * the rest. A cursor rather than "repeat until nothing matches" because a
 * ride can be analyzed and still have no descent (a track too short to sum,
 * a stream with no altitude), and such a ride would otherwise head every
 * batch forever and starve the older ones. Rides whose enqueue failed are
 * listed by id; the cursor walks past them, so rerun those by hand (an
 * enqueue of a ride already in the queue is a no-op).
 */
router.post('/backfill-descent', async (req, res) => {
  try {
    const dryRun = req.body?.dryRun === true;

    const params = parseBatchParams(req.body, DEFAULT_BACKFILL_LIMIT, MAX_BACKFILL_LIMIT);
    if ('error' in params) {
      return sendBadRequest(res, params.error);
    }
    const { limit, before, beforeId } = params;

    // A dry run queues nothing, so it should not spend the cooldown that
    // exists to keep real batches from stacking up.
    if (!dryRun) {
      const rateLimit = await checkAdminRateLimit('liftBackfillDescent', 'all');
      if (!rateLimit.allowed) {
        return sendTooManyRequests(res, 'Backfill recently requested', rateLimit.retryAfter);
      }
    }

    // Coordinates gate the worker too (it skips a ride without them), so a
    // ride missing them is "without stream" from the backfill's point of view.
    const fillableWhere = {
      elevationLossMeters: null,
      stream: { isNot: null },
      startLat: { not: null },
      startLng: { not: null },
    };

    const [fillableCount, unfillableCount, rides] = await Promise.all([
      prisma.ride.count({ where: fillableWhere }),
      prisma.ride.count({
        where: {
          elevationLossMeters: null,
          OR: [{ stream: null }, { startLat: null }, { startLng: null }],
        },
      }),
      dryRun
        ? Promise.resolve([] as { id: string; startTime: Date }[])
        : prisma.ride.findMany({
            where: { ...fillableWhere, ...cursorWhere(before, beforeId) },
            orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
            take: limit,
            select: { id: true, startTime: true },
          }),
    ]);

    // Per-ride failures are counted, not thrown: a Redis hiccup halfway
    // through must not turn the rides already queued into a 500 that reads
    // as "nothing happened".
    let queued = 0;
    let alreadyQueued = 0;
    const failedRideIds: string[] = [];
    for (const ride of rides) {
      try {
        const result = await enqueueLiftDetectionJob({ rideId: ride.id });
        if (result.status === 'queued') queued++;
        else alreadyQueued++;
      } catch (error) {
        failedRideIds.push(ride.id);
        logError(`Admin lift backfill descent enqueue ${ride.id}`, error);
      }
    }

    return sendSuccess(res, {
      dryRun,
      fillableCount,
      unfillableCount,
      queued,
      alreadyQueued,
      failed: failedRideIds.length,
      failedRideIds,
      // Null once a batch comes back short: there is nothing older to walk.
      nextCursor: dryRun ? null : nextCursor(rides, limit),
    });
  } catch (error) {
    logError('Admin lift backfill descent', error);
    return sendInternalError(res, 'Failed to enqueue descent backfill');
  }
});

/**
 * GET /api/admin/lift/queue
 * Lift queue job counts, for pacing a re-analysis: the next batch goes in
 * once `outstanding` is zero. `failed` growing during a batch means Overpass
 * is still rate limiting (a geometry-required job fails rather than store a
 * kinematic-only result), so let it rest before continuing.
 */
router.get('/queue', async (_req, res) => {
  try {
    const counts = await getLiftQueue().getJobCounts(
      'waiting',
      'prioritized',
      'active',
      'delayed',
      'failed',
      'completed'
    );
    return sendSuccess(res, {
      counts,
      // Jobs that have not reached a terminal state. Lift jobs carry a
      // priority, so one that is waiting sits in `prioritized`, not `waiting`.
      outstanding:
        (counts.waiting ?? 0) + (counts.prioritized ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0),
    });
  } catch (error) {
    logError('Admin lift queue', error);
    return sendInternalError(res, 'Failed to read lift queue');
  }
});

/**
 * POST /api/admin/lift/reanalyze
 * Force re-detection, in paced batches, for rides whose lift segments were
 * detected while Overpass was unavailable. The 2026-10-22 descent backfill
 * enqueued about a thousand rides at once, Overpass rate limited the burst,
 * and the worker (which then re-ran detection for every ride) stored
 * kinematic-only results: segments with geometryScore null, or no segments at
 * all where the stricter kinematic-only bar found nothing. The worker no
 * longer re-detects on that path (it fills the descent from the stored
 * segments), so the burst cannot recur, but this is the repair for what it
 * left behind.
 *
 * Each selected ride has its detector version cleared and is enqueued with
 * requireGeometry, so the worker runs the full pipeline against the stored
 * stream (no provider call) and, if Overpass is unavailable again, fails the
 * job, retried on a slow backoff, rather than store another kinematic-only
 * answer. A ride whose job gives up keeps its old segments and stays at
 * version null, where scope `pending` finds it.
 *
 * Body: {
 *   scope?: 'degraded' | 'all' | 'pending'   (default 'degraded')
 *     degraded  analyzed rides with at least one segment whose geometryScore
 *               is null: certainly affected, and the only ones findable
 *     all       every analyzed ride with a stored stream and coordinates,
 *               which is the backfill set. A ride where kinematic-only
 *               detection found nothing (so its geometry-matched segments
 *               were deleted) leaves no marker; only this scope reaches it.
 *     pending   rides with a stream and no detector version: a deferred job
 *               that gave up, an enqueue that failed below, or a stream with
 *               no altitude (harmless: the worker skips it before Overpass)
 *   limit?: number     batch size (default 50, cap 200)
 *   before?: string    ISO start time cursor, as for backfill-descent
 *   beforeId?: string  with `before`: the ride id the previous batch ended on
 *   dryRun?: boolean   counts only, no writes, no cooldown
 * }
 *
 * Pacing: lift jobs run two at a time and Overpass requests are serialized
 * at one per second app-wide, so a batch costs at most limit x cells
 * (12 cells at most per ride, and far fewer in practice: a park's cells are
 * cached for 180 days once any ride fetches them). The public Overpass
 * instance asks for about 10,000 requests a day and answers 429 when its
 * per-client slots are busy. Wait for GET /queue to report zero outstanding
 * before sending the next batch, and rest for several minutes when failures
 * appear.
 */
router.post('/reanalyze', async (req, res) => {
  try {
    const dryRun = req.body?.dryRun === true;

    const scopeRaw = req.body?.scope ?? 'degraded';
    if (!REANALYZE_SCOPES.includes(scopeRaw)) {
      return sendBadRequest(res, `scope must be one of: ${REANALYZE_SCOPES.join(', ')}`);
    }
    const scope = scopeRaw as ReanalyzeScope;

    const params = parseBatchParams(req.body, DEFAULT_REANALYZE_LIMIT, MAX_REANALYZE_LIMIT);
    if ('error' in params) {
      return sendBadRequest(res, params.error);
    }
    const { limit, before, beforeId } = params;

    if (!dryRun) {
      const rateLimit = await checkAdminRateLimit('liftReanalyze', 'all');
      if (!rateLimit.allowed) {
        return sendTooManyRequests(res, 'Re-analysis recently requested', rateLimit.retryAfter);
      }
    }

    // The worker needs a stored stream and coordinates to run at all, so
    // every scope starts there.
    const analyzableWhere = {
      stream: { isNot: null },
      startLat: { not: null },
      startLng: { not: null },
    };
    const scopeWhere = {
      degraded: {
        ...analyzableWhere,
        liftDetectorVersion: { not: null },
        segments: { some: { geometryScore: null } },
      },
      all: { ...analyzableWhere, liftDetectorVersion: { not: null } },
      pending: { ...analyzableWhere, liftDetectorVersion: null },
    };

    const [degradedCount, analyzedCount, pendingCount, rides] = await Promise.all([
      prisma.ride.count({ where: scopeWhere.degraded }),
      prisma.ride.count({ where: scopeWhere.all }),
      prisma.ride.count({ where: scopeWhere.pending }),
      dryRun
        ? Promise.resolve([] as { id: string; startTime: Date }[])
        : prisma.ride.findMany({
            where: { ...scopeWhere[scope], ...cursorWhere(before, beforeId) },
            orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
            take: limit,
            select: { id: true, startTime: true },
          }),
    ]);

    let queued = 0;
    let alreadyQueued = 0;
    const failedRideIds: string[] = [];
    for (const ride of rides) {
      try {
        // Clear the version first: that is what sends a ride with a stored
        // stream down the full pipeline instead of the descent-only path. If
        // the enqueue then fails, the ride is left in scope `pending`, where
        // a later batch picks it up; nothing on it has been changed yet.
        if (scope !== 'pending') {
          await prisma.ride.update({
            where: { id: ride.id },
            data: { liftDetectorVersion: null },
          });
        }
        const result = await enqueueLiftDetectionJob({ rideId: ride.id, requireGeometry: true });
        if (result.status === 'queued') queued++;
        else alreadyQueued++;
      } catch (error) {
        failedRideIds.push(ride.id);
        logError(`Admin lift reanalyze enqueue ${ride.id}`, error);
      }
    }

    return sendSuccess(res, {
      dryRun,
      scope,
      counts: { degraded: degradedCount, analyzed: analyzedCount, pending: pendingCount },
      queued,
      alreadyQueued,
      failed: failedRideIds.length,
      failedRideIds,
      nextCursor: dryRun ? null : nextCursor(rides, limit),
    });
  } catch (error) {
    logError('Admin lift reanalyze', error);
    return sendInternalError(res, 'Failed to enqueue lift re-analysis');
  }
});

/**
 * GET /api/admin/lift/fixture/:rideId
 * Export one analyzed ride (stream + segments + summary metrics) as JSON,
 * to be saved under apps/api/src/lib/lift-detection/__fixtures__/ as a
 * ground-truth detection test case.
 */
router.get('/fixture/:rideId', async (req, res) => {
  try {
    const { rideId } = req.params;
    if (!UUID_REGEX.test(rideId)) {
      return sendBadRequest(res, 'Invalid ride id');
    }

    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
      select: {
        id: true,
        startTime: true,
        location: true,
        durationSeconds: true,
        distanceMeters: true,
        elevationGainMeters: true,
        liftDetectorVersion: true,
        stream: { select: { source: true, pointCount: true, data: true } },
        segments: {
          orderBy: { startTime: 'asc' },
          select: {
            startIndex: true,
            endIndex: true,
            durationSeconds: true,
            elevationGainMeters: true,
            distanceMeters: true,
            confidence: true,
            kinematicScore: true,
            geometryScore: true,
            liftName: true,
            liftOsmId: true,
            detectorVersion: true,
          },
        },
      },
    });

    if (!ride) {
      return sendNotFound(res, 'Ride not found');
    }
    if (!ride.stream) {
      return sendNotFound(res, 'Ride has no persisted stream');
    }

    return sendSuccess(res, {
      // Fill in observed ground truth (actual lap count etc.) by hand when
      // saving this as a fixture.
      expectedLiftCount: null,
      notes: '',
      ride: {
        startTime: ride.startTime.toISOString(),
        location: ride.location,
        durationSeconds: ride.durationSeconds,
        distanceMeters: ride.distanceMeters,
        elevationGainMeters: ride.elevationGainMeters,
      },
      stream: ride.stream,
      detectedAtExport: {
        detectorVersion: ride.liftDetectorVersion,
        segments: ride.segments,
      },
    });
  } catch (error) {
    logError('Admin lift fixture', error);
    return sendInternalError(res, 'Failed to export fixture');
  }
});

export default router;
