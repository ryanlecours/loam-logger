const mockPrisma = {
  backfillRequest: {
    findFirst: jest.fn(),
    upsert: jest.fn(),
    updateMany: jest.fn(),
  },
  importSession: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
};
jest.mock('./prisma', () => ({ prisma: mockPrisma }));

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('./logger', () => ({ logger: mockLogger, logError: jest.fn() }));

const mockEnqueueBackfillJob = jest.fn();
jest.mock('./queue/backfill.queue', () => ({
  enqueueBackfillJob: (...args: unknown[]) => mockEnqueueBackfillJob(...args),
}));

const mockEnqueueSyncJob = jest.fn();
jest.mock('./queue/sync.queue', () => ({
  enqueueSyncJob: (...args: unknown[]) => mockEnqueueSyncJob(...args),
}));

const mockCaptureServerEvent = jest.fn();
jest.mock('./posthog', () => ({
  captureServerEvent: (...args: unknown[]) => mockCaptureServerEvent(...args),
}));

import { startAutoImport, AUTO_IMPORT_PERIOD } from './auto-import';
import { GARMIN_PERIOD_DAYS } from './garmin-backfill-periods';

const userId = 'user-123';

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.backfillRequest.findFirst.mockResolvedValue(null);
  mockPrisma.backfillRequest.upsert.mockResolvedValue({});
  mockPrisma.backfillRequest.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.importSession.findFirst.mockResolvedValue(null);
  mockPrisma.importSession.create.mockResolvedValue({ id: 'session-1' });
  mockEnqueueBackfillJob.mockResolvedValue({ status: 'queued', jobId: 'job-1' });
  mockEnqueueSyncJob.mockResolvedValue({ status: 'queued', jobId: 'sync-1' });
});

describe('startAutoImport', () => {
  it('uses a window the period table knows, so the worker can resolve it', () => {
    expect(Object.keys(GARMIN_PERIOD_DAYS)).toContain(AUTO_IMPORT_PERIOD);
  });

  it('queues a Strava backfill for the rolling window and records it as pending', async () => {
    const result = await startAutoImport(userId, 'strava');

    expect(result).toEqual({ status: 'queued', jobId: 'job-1' });
    expect(mockPrisma.backfillRequest.upsert).toHaveBeenCalledWith({
      where: { userId_provider_year: { userId, provider: 'strava', year: '365d' } },
      update: { status: 'pending', updatedAt: expect.any(Date) },
      create: { userId, provider: 'strava', year: '365d', status: 'pending' },
    });
    expect(mockEnqueueBackfillJob).toHaveBeenCalledWith({ userId, provider: 'strava', year: '365d' });
    // Strava imports finish inside the job; only Garmin and Suunto tag rides
    // with an ImportSession.
    expect(mockPrisma.importSession.create).not.toHaveBeenCalled();
  });

  it('opens an ImportSession for Garmin when none is running', async () => {
    await startAutoImport(userId, 'garmin');

    expect(mockPrisma.importSession.create).toHaveBeenCalledWith({
      data: { userId, provider: 'garmin', status: 'running', startedAt: expect.any(Date) },
    });
    expect(mockEnqueueBackfillJob).toHaveBeenCalledWith({ userId, provider: 'garmin', year: '365d' });
  });

  it('reuses a running ImportSession for Suunto instead of opening a second one', async () => {
    mockPrisma.importSession.findFirst.mockResolvedValue({ id: 'running-1' });

    await startAutoImport(userId, 'suunto');

    expect(mockPrisma.importSession.create).not.toHaveBeenCalled();
    expect(mockEnqueueBackfillJob).toHaveBeenCalledWith({ userId, provider: 'suunto', year: '365d' });
  });

  it('runs the 30-day sync for WHOOP, which has no history import', async () => {
    const result = await startAutoImport(userId, 'whoop');

    expect(result).toEqual({ status: 'queued', jobId: 'sync-1' });
    expect(mockEnqueueSyncJob).toHaveBeenCalledWith('syncLatest', { userId, provider: 'whoop' });
    expect(mockEnqueueBackfillJob).not.toHaveBeenCalled();
    expect(mockPrisma.backfillRequest.upsert).not.toHaveBeenCalled();
  });

  it('leaves a window that is already pending or running alone', async () => {
    mockPrisma.backfillRequest.findFirst.mockResolvedValue({ id: 'req-1' });

    const result = await startAutoImport(userId, 'garmin');

    expect(result).toEqual({ status: 'skipped', reason: 'in_progress' });
    expect(mockPrisma.backfillRequest.findFirst).toHaveBeenCalledWith({
      where: { userId, provider: 'garmin', year: '365d', status: { in: ['pending', 'in_progress'] } },
      select: { id: true },
    });
    expect(mockEnqueueBackfillJob).not.toHaveBeenCalled();
    expect(mockPrisma.importSession.create).not.toHaveBeenCalled();
  });

  it('marks the request failed when the queue refuses the job, and never throws', async () => {
    mockEnqueueBackfillJob.mockRejectedValue(new Error('redis down'));

    const result = await startAutoImport(userId, 'strava');

    expect(result).toEqual({ status: 'failed' });
    expect(mockPrisma.backfillRequest.updateMany).toHaveBeenCalledWith({
      where: { userId, provider: 'strava', year: '365d' },
      data: { status: 'failed', updatedAt: expect.any(Date) },
    });
  });

  it('reports failed rather than throwing when the database is unavailable', async () => {
    mockPrisma.backfillRequest.findFirst.mockRejectedValue(new Error('db down'));

    await expect(startAutoImport(userId, 'garmin')).resolves.toEqual({ status: 'failed' });
  });

  it('records the outcome as an analytics event either way', async () => {
    await startAutoImport(userId, 'strava');
    expect(mockCaptureServerEvent).toHaveBeenCalledWith(userId, 'auto_import_started', {
      provider: 'strava',
      period: '365d',
      status: 'queued',
    });

    mockCaptureServerEvent.mockClear();
    mockEnqueueSyncJob.mockRejectedValue(new Error('redis down'));
    await startAutoImport(userId, 'whoop');
    expect(mockCaptureServerEvent).toHaveBeenCalledWith(userId, 'auto_import_started', {
      provider: 'whoop',
      period: '30d',
      status: 'failed',
    });
  });
});
