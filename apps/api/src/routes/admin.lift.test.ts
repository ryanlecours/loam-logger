// Mock dependencies before imports
jest.mock('../lib/prisma', () => ({
  prisma: {
    ride: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    rideStream: { count: jest.fn() },
  },
}));

jest.mock('../auth/adminMiddleware', () => ({
  requireAdmin: jest.fn((_req, _res, next) => next()),
}));

jest.mock('../lib/rate-limit', () => ({
  checkAdminRateLimit: jest.fn(),
}));

const mockGetJobCounts = jest.fn();

jest.mock('../lib/queue', () => ({
  enqueueLiftDetectionJob: jest.fn(),
  getLiftQueue: jest.fn(() => ({ getJobCounts: mockGetJobCounts })),
}));

jest.mock('../lib/logger', () => ({
  logError: jest.fn(),
  logger: { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import express, { type Express } from 'express';
import request from 'supertest';
import adminLiftRouter from './admin.lift';
import { prisma } from '../lib/prisma';
import { checkAdminRateLimit } from '../lib/rate-limit';
import { enqueueLiftDetectionJob } from '../lib/queue';

const mockRideCount = prisma.ride.count as jest.Mock;
const mockRideFindMany = prisma.ride.findMany as jest.Mock;
const mockRideFindUnique = prisma.ride.findUnique as jest.Mock;
const mockRideUpdateMany = prisma.ride.updateMany as jest.Mock;
const mockStreamCount = prisma.rideStream.count as jest.Mock;
const mockRateLimit = checkAdminRateLimit as jest.Mock;
const mockEnqueue = enqueueLiftDetectionJob as jest.Mock;

const RIDE_ID = '11111111-2222-4333-8444-555555555555';

describe('Admin lift validation routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/admin/lift', adminLiftRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRateLimit.mockResolvedValue({ allowed: true, redisAvailable: true });
  });

  describe('GET /report', () => {
    const analyzedRide = {
      id: RIDE_ID,
      startTime: new Date('2026-07-12T16:00:00Z'),
      location: 'Whistler, BC',
      rideType: 'MountainBikeRide',
      durationSeconds: 14400,
      distanceMeters: 42000,
      elevationGainMeters: 2100,
      liftDurationSeconds: 5400,
      liftElevationGainMeters: 1800,
      liftDistanceMeters: 9000,
      liftDetectorVersion: 1,
      user: { email: 'rider@example.com' },
      segments: [
        {
          id: 'seg-1',
          kind: 'LIFT',
          startTime: new Date('2026-07-12T16:10:00Z'),
          endTime: new Date('2026-07-12T16:22:00Z'),
          durationSeconds: 720,
          elevationGainMeters: 380,
          distanceMeters: 1800,
          confidence: 0.96,
          kinematicScore: 0.91,
          geometryScore: 0.99,
          liftName: 'Fitzsimmons Express',
          liftOsmId: '123',
          detectorVersion: 1,
        },
      ],
    };

    it('returns summary counts and per-ride segment rows', async () => {
      mockRideCount
        .mockResolvedValueOnce(12) // analyzed
        .mockResolvedValueOnce(3) // with lift
        .mockResolvedValueOnce(2); // pending
      mockStreamCount.mockResolvedValueOnce(15);
      mockRideFindMany.mockResolvedValueOnce([analyzedRide]);

      const res = await request(app).get('/api/admin/lift/report');

      expect(res.status).toBe(200);
      expect(res.body.data.summary).toEqual({
        analyzedCount: 12,
        withLiftCount: 3,
        streamCount: 15,
        pendingCount: 2,
      });
      expect(res.body.data.rides).toHaveLength(1);
      const row = res.body.data.rides[0];
      expect(row.rideId).toBe(RIDE_ID);
      expect(row.userEmail).toBe('rider@example.com');
      expect(row.segmentCount).toBe(1);
      expect(row.liftDeltas).toEqual({
        durationSeconds: 5400,
        elevationGainMeters: 1800,
        distanceMeters: 9000,
      });
      expect(row.segments[0]).toMatchObject({
        liftName: 'Fitzsimmons Express',
        confidence: 0.96,
        geometryScore: 0.99,
        startTime: '2026-07-12T16:10:00.000Z',
      });
    });

    it('filters to analyzed rides only, honoring since and withSegmentsOnly', async () => {
      mockRideCount.mockResolvedValue(0);
      mockStreamCount.mockResolvedValue(0);
      mockRideFindMany.mockResolvedValueOnce([]);

      const res = await request(app).get(
        '/api/admin/lift/report?since=2026-07-01&withSegmentsOnly=true&limit=10'
      );

      expect(res.status).toBe(200);
      const findArgs = mockRideFindMany.mock.calls[0][0];
      expect(findArgs.where.liftDetectorVersion).toEqual({ not: null });
      expect(findArgs.where.startTime.gte).toEqual(new Date('2026-07-01'));
      expect(findArgs.where.segments).toEqual({ some: {} });
      expect(findArgs.take).toBe(10);
    });

    it('rejects an invalid since date', async () => {
      const res = await request(app).get('/api/admin/lift/report?since=not-a-date');
      expect(res.status).toBe(400);
    });

    it('caps limit at 200', async () => {
      mockRideCount.mockResolvedValue(0);
      mockStreamCount.mockResolvedValue(0);
      mockRideFindMany.mockResolvedValueOnce([]);

      await request(app).get('/api/admin/lift/report?limit=9999');

      expect(mockRideFindMany.mock.calls[0][0].take).toBe(200);
    });
  });

  describe('POST /backfill-descent', () => {
    const ids = [
      '11111111-2222-4333-8444-555555555551',
      '11111111-2222-4333-8444-555555555552',
    ];

    const rows = ids.map((id, i) => ({ id, startTime: new Date(`2026-07-0${i + 1}T10:00:00Z`) }));

    it('enqueues a full batch and hands back a cursor for the next one', async () => {
      mockRideCount.mockResolvedValueOnce(5).mockResolvedValueOnce(12);
      mockRideFindMany.mockResolvedValueOnce(rows);
      mockEnqueue
        .mockResolvedValueOnce({ status: 'queued', jobId: 'a' })
        .mockResolvedValueOnce({ status: 'already_queued', jobId: 'b' });

      const res = await request(app).post('/api/admin/lift/backfill-descent').send({ limit: 2 });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        dryRun: false,
        fillableCount: 5,
        unfillableCount: 12,
        queued: 1,
        alreadyQueued: 1,
        failed: 0,
        failedRideIds: [],
        // The oldest (start time, id) in the batch, for the caller's next call.
        nextCursor: { before: '2026-07-02T10:00:00.000Z', beforeId: ids[1] },
      });
      expect(mockRideFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ startTime: 'desc' }, { id: 'desc' }] })
      );
      // Only rides with a stream, coordinates and no descent are candidates.
      expect(mockRideFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            elevationLossMeters: null,
            stream: { isNot: null },
            startLat: { not: null },
            startLng: { not: null },
          },
          take: 2,
        })
      );
      expect(mockEnqueue).toHaveBeenCalledTimes(2);
      expect(mockEnqueue).toHaveBeenCalledWith({ rideId: ids[0] });
    });

    it('pages by start time and ends the walk on a short batch', async () => {
      mockRideCount.mockResolvedValue(0);
      mockRideFindMany.mockResolvedValueOnce([rows[0]]);
      mockEnqueue.mockResolvedValue({ status: 'queued', jobId: 'a' });

      const boundary = new Date('2026-07-02T10:00:00.000Z');
      const res = await request(app)
        .post('/api/admin/lift/backfill-descent')
        .send({ limit: 2, before: boundary.toISOString(), beforeId: ids[1] });

      expect(res.status).toBe(200);
      // Older than the boundary, or at the boundary with a smaller id: a
      // second ride sharing the last start time is not skipped.
      expect(mockRideFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ startTime: { lt: boundary } }, { startTime: boundary, id: { lt: ids[1] } }],
          }),
        })
      );
      // One ride back from a batch of two: nothing older is left.
      expect(res.body.data.nextCursor).toBeNull();

      // Without an id the cursor is start time alone.
      mockRideFindMany.mockResolvedValueOnce([]);
      await request(app).post('/api/admin/lift/backfill-descent').send({ before: boundary.toISOString() });
      expect(mockRideFindMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ startTime: { lt: boundary } }) })
      );
    });

    it('rejects a bad cursor before spending the cooldown', async () => {
      const bad = await request(app).post('/api/admin/lift/backfill-descent').send({ before: 'yesterday' });
      expect(bad.status).toBe(400);

      const orphanId = await request(app).post('/api/admin/lift/backfill-descent').send({ beforeId: ids[0] });
      expect(orphanId.status).toBe(400);

      const notAnId = await request(app)
        .post('/api/admin/lift/backfill-descent')
        .send({ before: '2026-07-02T10:00:00.000Z', beforeId: 'nope' });
      expect(notAnId.status).toBe(400);

      expect(mockRateLimit).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('counts without enqueueing on a dry run, and spends no cooldown', async () => {
      mockRideCount.mockResolvedValueOnce(5).mockResolvedValueOnce(12);

      const res = await request(app).post('/api/admin/lift/backfill-descent').send({ dryRun: true });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ dryRun: true, fillableCount: 5, queued: 0, nextCursor: null });
      expect(mockRideFindMany).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
      expect(mockRateLimit).not.toHaveBeenCalled();
    });

    it('caps the limit at 1000, defaults it to 200, and ignores non-numeric limits', async () => {
      mockRideCount.mockResolvedValue(0);
      mockRideFindMany.mockResolvedValue([]);

      await request(app).post('/api/admin/lift/backfill-descent').send({ limit: 5000 });
      expect(mockRideFindMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 1000 }));

      await request(app).post('/api/admin/lift/backfill-descent').send({ limit: -4 });
      expect(mockRideFindMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 1 }));

      for (const limit of [undefined, '50', true, null]) {
        await request(app).post('/api/admin/lift/backfill-descent').send({ limit });
        expect(mockRideFindMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 200 }));
      }
    });

    it('counts a ride whose enqueue throws and keeps going', async () => {
      mockRideCount.mockResolvedValue(0);
      mockRideFindMany.mockResolvedValueOnce(rows);
      mockEnqueue
        .mockRejectedValueOnce(new Error('redis down'))
        .mockResolvedValueOnce({ status: 'queued', jobId: 'b' });

      const res = await request(app).post('/api/admin/lift/backfill-descent').send({ limit: 2 });

      expect(res.status).toBe(200);
      // The failed id is named so the admin can rerun it; the cursor moves on.
      expect(res.body.data).toMatchObject({ queued: 1, failed: 1, failedRideIds: [ids[0]] });
      expect(mockEnqueue).toHaveBeenCalledTimes(2);
    });

    it('applies the cooldown', async () => {
      mockRateLimit.mockResolvedValueOnce({ allowed: false, retryAfter: 60 });

      const res = await request(app).post('/api/admin/lift/backfill-descent').send({});

      expect(res.status).toBe(429);
      expect(mockEnqueue).not.toHaveBeenCalled();
    });
  });

  describe('POST /analyze/:rideId', () => {
    const eligibleRide = {
      id: RIDE_ID,
      stravaActivityId: '9876',
      startLat: 50.1,
      startLng: -122.9,
      liftDetectorVersion: 1,
    };

    it('enqueues analysis for an eligible ride', async () => {
      mockRideFindUnique.mockResolvedValueOnce(eligibleRide);
      mockEnqueue.mockResolvedValueOnce({ status: 'queued', jobId: `detectLifts_${RIDE_ID}` });

      const res = await request(app).post(`/api/admin/lift/analyze/${RIDE_ID}`).send({});

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ status: 'queued', jobId: `detectLifts_${RIDE_ID}` });
      expect(mockEnqueue).toHaveBeenCalledWith({ rideId: RIDE_ID });
      expect(mockRideUpdateMany).not.toHaveBeenCalled();
    });

    it('with force, enqueues a forced job and then clears the detector version', async () => {
      mockRideFindUnique.mockResolvedValueOnce(eligibleRide);
      mockEnqueue.mockResolvedValueOnce({ status: 'queued', jobId: 'j' });

      const res = await request(app)
        .post(`/api/admin/lift/analyze/${RIDE_ID}`)
        .send({ force: true });

      expect(res.status).toBe(200);
      expect(mockEnqueue).toHaveBeenCalledWith({ rideId: RIDE_ID, force: true });
      expect(mockRideUpdateMany).toHaveBeenCalledWith({
        where: { id: RIDE_ID, liftDetectorVersion: { not: null } },
        data: { liftDetectorVersion: null },
      });
      // The job carries the instruction; the clear only follows a confirmed
      // enqueue, never precedes it.
      expect(mockEnqueue.mock.invocationCallOrder[0]).toBeLessThan(
        mockRideUpdateMany.mock.invocationCallOrder[0]
      );
    });

    it('with force, leaves the version alone when a job for the ride is already queued', async () => {
      // That job may predate requireGeometry; handing it a version-null ride
      // would invite the kinematic-only overwrite this path guards against.
      mockRideFindUnique.mockResolvedValueOnce(eligibleRide);
      mockEnqueue.mockResolvedValueOnce({ status: 'already_queued', jobId: 'j' });

      const res = await request(app)
        .post(`/api/admin/lift/analyze/${RIDE_ID}`)
        .send({ force: true });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('already_queued');
      expect(mockRideUpdateMany).not.toHaveBeenCalled();
    });

    it('rejects non-boolean flags', async () => {
      for (const body of [{ force: 'true' }, { requireGeometry: 1 }]) {
        const res = await request(app).post(`/api/admin/lift/analyze/${RIDE_ID}`).send(body);
        expect(res.status).toBe(400);
      }
      expect(mockRateLimit).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('rejects invalid ids, unknown rides, and non-Strava rides without a stored stream', async () => {
      const bad = await request(app).post('/api/admin/lift/analyze/not-a-uuid').send({});
      expect(bad.status).toBe(400);

      mockRideFindUnique.mockResolvedValueOnce(null);
      const missing = await request(app).post(`/api/admin/lift/analyze/${RIDE_ID}`).send({});
      expect(missing.status).toBe(404);

      // Nothing stored and nowhere to fetch from: the worker could not run.
      mockRideFindUnique.mockResolvedValueOnce({ ...eligibleRide, stravaActivityId: null, stream: null });
      const manual = await request(app).post(`/api/admin/lift/analyze/${RIDE_ID}`).send({});
      expect(manual.status).toBe(400);

      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('accepts a non-Strava ride that has a stored stream', async () => {
      // In-app and Garmin rides were in the descent backfill set and the
      // worker reuses their stream, so the force path must reach them.
      mockRideFindUnique.mockResolvedValueOnce({
        ...eligibleRide,
        stravaActivityId: null,
        stream: { id: 'stream-1' },
      });
      mockEnqueue.mockResolvedValueOnce({ status: 'queued', jobId: 'j' });

      const res = await request(app).post(`/api/admin/lift/analyze/${RIDE_ID}`).send({});

      expect(res.status).toBe(200);
      expect(mockEnqueue).toHaveBeenCalledWith({ rideId: RIDE_ID });
    });

    it('passes requireGeometry through to the job', async () => {
      mockRideFindUnique.mockResolvedValueOnce(eligibleRide);
      mockEnqueue.mockResolvedValueOnce({ status: 'queued', jobId: 'j' });

      await request(app)
        .post(`/api/admin/lift/analyze/${RIDE_ID}`)
        .send({ force: true, requireGeometry: true });

      expect(mockEnqueue).toHaveBeenCalledWith({ rideId: RIDE_ID, force: true, requireGeometry: true });
    });

    it('applies the per-ride cooldown', async () => {
      mockRateLimit.mockResolvedValueOnce({ allowed: false, retryAfter: 5, redisAvailable: true });

      const res = await request(app).post(`/api/admin/lift/analyze/${RIDE_ID}`).send({});

      expect(res.status).toBe(429);
      expect(mockRateLimit).toHaveBeenCalledWith('liftAnalyze', RIDE_ID);
      expect(mockRideFindUnique).not.toHaveBeenCalled();
    });
  });

  describe('GET /queue', () => {
    it('returns job counts and the number still outstanding', async () => {
      mockGetJobCounts.mockResolvedValueOnce({
        waiting: 0,
        prioritized: 7,
        active: 2,
        delayed: 1,
        failed: 3,
        completed: 50,
      });

      const res = await request(app).get('/api/admin/lift/queue');

      expect(res.status).toBe(200);
      // Lift jobs carry a priority, so a waiting job counts under prioritized.
      expect(res.body.data.outstanding).toBe(10);
      expect(res.body.data.counts.failed).toBe(3);
    });
  });

  describe('POST /reanalyze', () => {
    const ids = [
      '11111111-2222-4333-8444-555555555551',
      '11111111-2222-4333-8444-555555555552',
    ];
    const rows = ids.map((id, i) => ({ id, startTime: new Date(`2026-07-0${i + 1}T10:00:00Z`) }));

    const analyzable = {
      stream: { isNot: null },
      startLat: { not: null },
      startLng: { not: null },
    };

    beforeEach(() => {
      // degraded, analyzed, pending
      mockRideCount.mockResolvedValueOnce(40).mockResolvedValueOnce(1015).mockResolvedValueOnce(3);
      mockRideUpdateMany.mockResolvedValue({ count: 1 });
    });

    it('defaults to the degraded scope: enqueues each ride forced with geometry required, then clears it', async () => {
      mockRideFindMany.mockResolvedValueOnce(rows);
      mockEnqueue
        .mockResolvedValueOnce({ status: 'queued', jobId: 'a' })
        .mockResolvedValueOnce({ status: 'already_queued', jobId: 'b' });

      const res = await request(app).post('/api/admin/lift/reanalyze').send({ limit: 2 });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        dryRun: false,
        scope: 'degraded',
        counts: { degraded: 40, analyzed: 1015, pending: 3 },
        queued: 1,
        alreadyQueued: 1,
        failed: 0,
        failedRideIds: [],
        nextCursor: { before: '2026-07-02T10:00:00.000Z', beforeId: ids[1] },
      });
      // A null geometryScore on any segment is the marker of a ride detected
      // while Overpass was unavailable.
      expect(mockRideFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            ...analyzable,
            liftDetectorVersion: { not: null },
            segments: { some: { geometryScore: null } },
          },
          orderBy: [{ startTime: 'desc' }, { id: 'desc' }],
          take: 2,
        })
      );
      for (const id of ids) {
        expect(mockEnqueue).toHaveBeenCalledWith({ rideId: id, force: true, requireGeometry: true });
      }
      // Only the ride whose job was actually queued has its version cleared;
      // the one with a job already in the queue is left to that job.
      expect(mockRideUpdateMany).toHaveBeenCalledTimes(1);
      expect(mockRideUpdateMany).toHaveBeenCalledWith({
        where: { id: ids[0], liftDetectorVersion: { not: null } },
        data: { liftDetectorVersion: null },
      });
      // And cleared after the enqueue, never before it.
      expect(mockEnqueue.mock.invocationCallOrder[0]).toBeLessThan(
        mockRideUpdateMany.mock.invocationCallOrder[0]
      );
      expect(mockRateLimit).toHaveBeenCalledWith('liftReanalyze', 'all');
    });

    it('scope all takes every analyzed ride with a stream, for the rides that left no marker', async () => {
      mockRideFindMany.mockResolvedValueOnce([]);

      const res = await request(app).post('/api/admin/lift/reanalyze').send({ scope: 'all' });

      expect(res.status).toBe(200);
      expect(res.body.data.scope).toBe('all');
      expect(mockRideFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { ...analyzable, liftDetectorVersion: { not: null } },
          take: 50,
        })
      );
    });

    it('scope pending re-enqueues version-null rides the same way', async () => {
      mockRideFindMany.mockResolvedValueOnce([rows[0]]);
      mockEnqueue.mockResolvedValueOnce({ status: 'queued', jobId: 'a' });

      const res = await request(app).post('/api/admin/lift/reanalyze').send({ scope: 'pending' });

      expect(res.status).toBe(200);
      expect(mockRideFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ...analyzable, liftDetectorVersion: null } })
      );
      expect(mockEnqueue).toHaveBeenCalledWith({ rideId: ids[0], force: true, requireGeometry: true });
    });

    it('walks the cursor without recounting, and ends on a short batch', async () => {
      mockRideCount.mockReset();
      mockRideFindMany.mockResolvedValueOnce([rows[0]]);
      mockEnqueue.mockResolvedValue({ status: 'queued', jobId: 'a' });

      const boundary = new Date('2026-07-02T10:00:00.000Z');
      const res = await request(app)
        .post('/api/admin/lift/reanalyze')
        .send({ limit: 2, before: boundary.toISOString(), beforeId: ids[1] });

      expect(res.status).toBe(200);
      expect(mockRideFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ startTime: { lt: boundary } }, { startTime: boundary, id: { lt: ids[1] } }],
          }),
        })
      );
      expect(res.body.data.nextCursor).toBeNull();
      // The three scope counts run on the first call and on dry runs only.
      expect(mockRideCount).not.toHaveBeenCalled();
      expect(res.body.data.counts).toBeNull();
    });

    it('rejects an unknown scope or a bad cursor before spending the cooldown', async () => {
      const scope = await request(app).post('/api/admin/lift/reanalyze').send({ scope: 'everything' });
      expect(scope.status).toBe(400);

      const cursor = await request(app).post('/api/admin/lift/reanalyze').send({ before: 'yesterday' });
      expect(cursor.status).toBe(400);

      expect(mockRateLimit).not.toHaveBeenCalled();
      expect(mockRideUpdateMany).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('counts without writing on a dry run, and spends no cooldown', async () => {
      const res = await request(app).post('/api/admin/lift/reanalyze').send({ dryRun: true, scope: 'all' });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        dryRun: true,
        scope: 'all',
        counts: { degraded: 40, analyzed: 1015, pending: 3 },
        queued: 0,
        nextCursor: null,
      });
      expect(mockRideFindMany).not.toHaveBeenCalled();
      expect(mockRideUpdateMany).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
      expect(mockRateLimit).not.toHaveBeenCalled();
    });

    it('caps the limit at 200 and defaults it to 50', async () => {
      mockRideFindMany.mockResolvedValue([]);

      await request(app).post('/api/admin/lift/reanalyze').send({ limit: 999 });
      expect(mockRideFindMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 200 }));

      mockRideCount.mockResolvedValue(0);
      await request(app).post('/api/admin/lift/reanalyze').send({});
      expect(mockRideFindMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 50 }));
    });

    it('lists a ride whose enqueue threw and keeps going', async () => {
      mockRideFindMany.mockResolvedValueOnce(rows);
      mockEnqueue
        .mockRejectedValueOnce(new Error('redis down'))
        .mockResolvedValueOnce({ status: 'queued', jobId: 'b' });

      const res = await request(app).post('/api/admin/lift/reanalyze').send({ limit: 2 });

      expect(res.status).toBe(200);
      // Untouched, so it is still in its scope for the next walk.
      expect(res.body.data).toMatchObject({ queued: 1, failed: 1, failedRideIds: [ids[0]] });
      expect(mockEnqueue).toHaveBeenCalledTimes(2);
      expect(mockRideUpdateMany).toHaveBeenCalledTimes(1);
      expect(mockRideUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: ids[1] }) })
      );
    });

    it('applies the cooldown', async () => {
      mockRateLimit.mockResolvedValueOnce({ allowed: false, retryAfter: 30 });

      const res = await request(app).post('/api/admin/lift/reanalyze').send({});

      expect(res.status).toBe(429);
      expect(mockRideUpdateMany).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
    });
  });

  describe('GET /fixture/:rideId', () => {
    it('exports stream, segments, and summary metrics', async () => {
      mockRideFindUnique.mockResolvedValueOnce({
        id: RIDE_ID,
        startTime: new Date('2026-07-12T16:00:00Z'),
        location: 'Whistler, BC',
        durationSeconds: 14400,
        distanceMeters: 42000,
        elevationGainMeters: 2100,
        liftDetectorVersion: 1,
        stream: { source: 'strava', pointCount: 2, data: { time: [0, 5] } },
        segments: [{ startIndex: 0, endIndex: 1, confidence: 0.9 }],
      });

      const res = await request(app).get(`/api/admin/lift/fixture/${RIDE_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.data.expectedLiftCount).toBeNull();
      expect(res.body.data.stream.pointCount).toBe(2);
      expect(res.body.data.detectedAtExport.segments).toHaveLength(1);
      expect(res.body.data.ride.location).toBe('Whistler, BC');
    });

    it('404s when the ride has no persisted stream', async () => {
      mockRideFindUnique.mockResolvedValueOnce({
        id: RIDE_ID,
        startTime: new Date(),
        location: null,
        durationSeconds: 1,
        distanceMeters: 1,
        elevationGainMeters: 1,
        liftDetectorVersion: null,
        stream: null,
        segments: [],
      });

      const res = await request(app).get(`/api/admin/lift/fixture/${RIDE_ID}`);
      expect(res.status).toBe(404);
    });
  });
});
