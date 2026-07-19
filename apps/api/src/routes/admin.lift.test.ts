// Mock dependencies before imports
jest.mock('../lib/prisma', () => ({
  prisma: {
    ride: { count: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    rideStream: { count: jest.fn() },
  },
}));

jest.mock('../auth/adminMiddleware', () => ({
  requireAdmin: jest.fn((_req, _res, next) => next()),
}));

jest.mock('../lib/rate-limit', () => ({
  checkAdminRateLimit: jest.fn(),
}));

jest.mock('../lib/queue', () => ({
  enqueueLiftDetectionJob: jest.fn(),
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
const mockRideUpdate = prisma.ride.update as jest.Mock;
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
      expect(mockRideUpdate).not.toHaveBeenCalled();
    });

    it('clears the detector version first when force is set', async () => {
      mockRideFindUnique.mockResolvedValueOnce(eligibleRide);
      mockEnqueue.mockResolvedValueOnce({ status: 'queued', jobId: 'j' });

      const res = await request(app)
        .post(`/api/admin/lift/analyze/${RIDE_ID}`)
        .send({ force: true });

      expect(res.status).toBe(200);
      expect(mockRideUpdate).toHaveBeenCalledWith({
        where: { id: RIDE_ID },
        data: { liftDetectorVersion: null },
      });
    });

    it('rejects invalid ids, unknown rides, and non-Strava rides', async () => {
      const bad = await request(app).post('/api/admin/lift/analyze/not-a-uuid').send({});
      expect(bad.status).toBe(400);

      mockRideFindUnique.mockResolvedValueOnce(null);
      const missing = await request(app).post(`/api/admin/lift/analyze/${RIDE_ID}`).send({});
      expect(missing.status).toBe(404);

      mockRideFindUnique.mockResolvedValueOnce({ ...eligibleRide, stravaActivityId: null });
      const manual = await request(app).post(`/api/admin/lift/analyze/${RIDE_ID}`).send({});
      expect(manual.status).toBe(400);

      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('applies the per-ride cooldown', async () => {
      mockRateLimit.mockResolvedValueOnce({ allowed: false, retryAfter: 5, redisAvailable: true });

      const res = await request(app).post(`/api/admin/lift/analyze/${RIDE_ID}`).send({});

      expect(res.status).toBe(429);
      expect(mockRateLimit).toHaveBeenCalledWith('liftAnalyze', RIDE_ID);
      expect(mockRideFindUnique).not.toHaveBeenCalled();
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
