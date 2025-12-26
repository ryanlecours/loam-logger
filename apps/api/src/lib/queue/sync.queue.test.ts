// Mock connection first (before any imports that use it)
jest.mock('./connection', () => ({
  getQueueConnection: jest.fn(() => ({
    connection: {
      host: 'localhost',
      port: 6379,
    },
  })),
}));

// Create mock functions we can control per test
const mockQueueAdd = jest.fn();
const mockQueueClose = jest.fn().mockResolvedValue(undefined);

// Mock bullmq
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    close: mockQueueClose,
  })),
}));

import { buildSyncJobId, enqueueSyncJob, getSyncQueue, closeSyncQueue } from './sync.queue';
import type { SyncJobData } from './sync.queue';

describe('buildSyncJobId', () => {
  describe('syncLatest jobs', () => {
    it('should build ID for strava syncLatest', () => {
      const result = buildSyncJobId('syncLatest', 'strava', 'user123');
      expect(result).toBe('syncLatest:strava:user123');
    });

    it('should build ID for garmin syncLatest', () => {
      const result = buildSyncJobId('syncLatest', 'garmin', 'user456');
      expect(result).toBe('syncLatest:garmin:user456');
    });

    it('should build ID for suunto syncLatest', () => {
      const result = buildSyncJobId('syncLatest', 'suunto', 'user789');
      expect(result).toBe('syncLatest:suunto:user789');
    });

    it('should ignore activityId for syncLatest', () => {
      const result = buildSyncJobId('syncLatest', 'strava', 'user123', 'activity456');
      expect(result).toBe('syncLatest:strava:user123');
    });
  });

  describe('syncActivity jobs', () => {
    it('should include activityId for syncActivity', () => {
      const result = buildSyncJobId('syncActivity', 'strava', 'user123', 'activity456');
      expect(result).toBe('syncActivity:strava:user123:activity456');
    });

    it('should omit activityId if not provided for syncActivity', () => {
      const result = buildSyncJobId('syncActivity', 'garmin', 'user123');
      expect(result).toBe('syncActivity:garmin:user123');
    });

    it('should handle empty activityId for syncActivity', () => {
      const result = buildSyncJobId('syncActivity', 'strava', 'user123', '');
      expect(result).toBe('syncActivity:strava:user123');
    });
  });
});

describe('enqueueSyncJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the singleton
    closeSyncQueue();
    mockQueueAdd.mockResolvedValue({});
  });

  afterEach(async () => {
    await closeSyncQueue();
  });

  it('should return queued status for new job', async () => {
    const data: SyncJobData = { userId: 'user123', provider: 'strava' };

    const result = await enqueueSyncJob('syncLatest', data);

    expect(result).toEqual({
      status: 'queued',
      jobId: 'syncLatest:strava:user123',
    });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'syncLatest',
      data,
      { jobId: 'syncLatest:strava:user123' }
    );
  });

  it('should return already_queued status for duplicate job', async () => {
    mockQueueAdd.mockRejectedValue(new Error('Job syncLatest:strava:user123 already exists'));

    const data: SyncJobData = { userId: 'user123', provider: 'strava' };

    const result = await enqueueSyncJob('syncLatest', data);

    expect(result).toEqual({
      status: 'already_queued',
      jobId: 'syncLatest:strava:user123',
    });
  });

  it('should rethrow unexpected errors', async () => {
    mockQueueAdd.mockRejectedValue(new Error('Redis connection failed'));

    const data: SyncJobData = { userId: 'user123', provider: 'strava' };

    await expect(enqueueSyncJob('syncLatest', data)).rejects.toThrow('Redis connection failed');
  });

  it('should include activityId for syncActivity job', async () => {
    const data: SyncJobData = { userId: 'user123', provider: 'garmin', activityId: 'act456' };

    const result = await enqueueSyncJob('syncActivity', data);

    expect(result.jobId).toBe('syncActivity:garmin:user123:act456');
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'syncActivity',
      data,
      { jobId: 'syncActivity:garmin:user123:act456' }
    );
  });
});

describe('getSyncQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    closeSyncQueue();
  });

  afterEach(async () => {
    await closeSyncQueue();
  });

  it('should return the same queue instance on subsequent calls', () => {
    const queue1 = getSyncQueue();
    const queue2 = getSyncQueue();

    expect(queue1).toBe(queue2);
  });
});

describe('closeSyncQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should close the queue if it exists', async () => {
    // Initialize the queue
    getSyncQueue();

    await closeSyncQueue();

    expect(mockQueueClose).toHaveBeenCalled();
  });

  it('should be safe to call multiple times', async () => {
    await closeSyncQueue();
    await closeSyncQueue();
    // No error thrown
  });
});
