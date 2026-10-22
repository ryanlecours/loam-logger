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
import { enqueueLiftDetectionJob } from '../lib/queue';
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
 * Body: { force?: boolean } — re-analyze even if already at the current
 * detector version (clears the version so the worker reruns).
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
      },
    });

    if (!ride) {
      return sendNotFound(res, 'Ride not found');
    }
    if (!ride.stravaActivityId) {
      return sendBadRequest(res, 'Ride is not Strava-sourced; lift analysis is Strava-only for now');
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

    const result = await enqueueLiftDetectionJob({ rideId });
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
 *   before?: string    ISO start time; only rides starting before it
 *   dryRun?: boolean   counts only, no enqueue, no cooldown
 * }
 *
 * Paging is by start time, newest first, and the response's nextCursor is
 * the oldest start time in the batch. Pass it back as `before` to walk the
 * rest. A cursor rather than "repeat until nothing matches" because a ride
 * can be analyzed and still have no descent (a track too short to sum, a
 * stream with no altitude), and such a ride would otherwise head every
 * batch forever and starve the older ones.
 */
router.post('/backfill-descent', async (req, res) => {
  try {
    const dryRun = req.body?.dryRun === true;

    // A dry run queues nothing, so it should not spend the cooldown that
    // exists to keep real batches from stacking up.
    if (!dryRun) {
      const rateLimit = await checkAdminRateLimit('liftBackfillDescent', 'all');
      if (!rateLimit.allowed) {
        return sendTooManyRequests(res, 'Backfill recently requested', rateLimit.retryAfter);
      }
    }

    const limitRaw = req.body?.limit;
    const limit =
      typeof limitRaw === 'number' && Number.isFinite(limitRaw)
        ? Math.min(Math.max(Math.trunc(limitRaw), 1), MAX_BACKFILL_LIMIT)
        : DEFAULT_BACKFILL_LIMIT;

    let before: Date | undefined;
    if (req.body?.before !== undefined) {
      before = new Date(String(req.body.before));
      if (Number.isNaN(before.getTime())) {
        return sendBadRequest(res, 'Invalid before date');
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
            where: { ...fillableWhere, ...(before ? { startTime: { lt: before } } : {}) },
            orderBy: { startTime: 'desc' },
            take: limit,
            select: { id: true, startTime: true },
          }),
    ]);

    // Per-ride failures are counted, not thrown: a Redis hiccup halfway
    // through must not turn the rides already queued into a 500 that reads
    // as "nothing happened".
    let queued = 0;
    let alreadyQueued = 0;
    let failed = 0;
    for (const ride of rides) {
      try {
        const result = await enqueueLiftDetectionJob({ rideId: ride.id });
        if (result.status === 'queued') queued++;
        else alreadyQueued++;
      } catch (error) {
        failed++;
        logError(`Admin lift backfill descent enqueue ${ride.id}`, error);
      }
    }

    const last = rides[rides.length - 1];
    return sendSuccess(res, {
      dryRun,
      fillableCount,
      unfillableCount,
      queued,
      alreadyQueued,
      failed,
      // Null once a batch comes back short: there is nothing older to walk.
      nextCursor: !dryRun && rides.length === limit && last ? last.startTime.toISOString() : null,
    });
  } catch (error) {
    logError('Admin lift backfill descent', error);
    return sendInternalError(res, 'Failed to enqueue descent backfill');
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
