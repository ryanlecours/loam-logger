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
// BullMQ 5 absorbs a duplicate jobId rather than throwing, so the enqueue path
// asks whether the job exists first. Default: nothing is queued.
const mockQueueGetJob = jest.fn().mockResolvedValue(undefined);

// Mock bullmq
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    close: mockQueueClose,
    getJob: mockQueueGetJob,
  })),
}));

import { buildSyncJobId, enqueueSyncJob, getSyncQueue, closeSyncQueue } from './sync.queue';
import type { SyncJobData } from './sync.queue';

describe('buildSyncJobId', () => {
  describe('syncLatest jobs', () => {
    it('should build ID for strava syncLatest', () => {
      const result = buildSyncJobId('syncLatest', 'strava', 'user123');
      expect(result).toBe('syncLatest_strava_user123');
    });

    it('should build ID for garmin syncLatest', () => {
      const result = buildSyncJobId('syncLatest', 'garmin', 'user456');
      expect(result).toBe('syncLatest_garmin_user456');
    });

    it('should build ID for suunto syncLatest', () => {
      const result = buildSyncJobId('syncLatest', 'suunto', 'user789');
      expect(result).toBe('syncLatest_suunto_user789');
    });

    it('should ignore activityId for syncLatest', () => {
      const result = buildSyncJobId('syncLatest', 'strava', 'user123', 'activity456');
      expect(result).toBe('syncLatest_strava_user123');
    });
  });

  describe('syncActivity jobs', () => {
    it('should include activityId for syncActivity', () => {
      const result = buildSyncJobId('syncActivity', 'strava', 'user123', 'activity456');
      expect(result).toBe('syncActivity_strava_user123_activity456');
    });

    it('should omit activityId if not provided for syncActivity', () => {
      const result = buildSyncJobId('syncActivity', 'garmin', 'user123');
      expect(result).toBe('syncActivity_garmin_user123');
    });

    it('should handle empty activityId for syncActivity', () => {
      const result = buildSyncJobId('syncActivity', 'strava', 'user123', '');
      expect(result).toBe('syncActivity_strava_user123');
    });
  });
});

/**
 * Regression pins for edits being silently dropped.
 *
 * A manually-updated Garmin activity is the SAME activity, so before the id
 * carried the payload's contents an edit produced the same job id as the
 * original sync. BullMQ dedupes against retained completed jobs, so the
 * correction was discarded, and because BullMQ 5 absorbs a duplicate rather
 * than throwing, the caller was told it had been queued.
 */
describe('pushed activity job ids', () => {
  const base = {
    summaryId: 'summary-456',
    activityType: 'MOUNTAIN_BIKING',
    durationInSeconds: 5340,
  };

  it('gives an edited activity a different id from the original', () => {
    const original = buildSyncJobId('syncActivity', 'garmin', 'u1', 'summary-456', 'aaa');
    const edited = buildSyncJobId('syncActivity', 'garmin', 'u1', 'summary-456', 'bbb');

    expect(original).not.toBe(edited);
  });

  it('keeps notification-driven ids unchanged', () => {
    expect(buildSyncJobId('syncActivity', 'garmin', 'u1', 'summary-456')).toBe(
      'syncActivity_garmin_u1_summary-456'
    );
  });

  it('queues an edit that changes the activity type', async () => {
    await enqueueSyncJob('syncActivity', {
      userId: 'u1',
      provider: 'garmin',
      activityId: 'summary-456',
      pushedActivity: base,
    });
    const originalId = mockQueueAdd.mock.calls[0][2].jobId;

    await enqueueSyncJob('syncActivity', {
      userId: 'u1',
      provider: 'garmin',
      activityId: 'summary-456',
      pushedActivity: { ...base, activityType: 'HIKING' },
    });
    const editedId = mockQueueAdd.mock.calls[1][2].jobId;

    expect(editedId).not.toBe(originalId);
  });

  it('queues an edit that only trims the duration', async () => {
    await enqueueSyncJob('syncActivity', {
      userId: 'u1',
      provider: 'garmin',
      activityId: 'summary-456',
      pushedActivity: base,
    });
    await enqueueSyncJob('syncActivity', {
      userId: 'u1',
      provider: 'garmin',
      activityId: 'summary-456',
      pushedActivity: { ...base, durationInSeconds: 3600 },
    });

    expect(mockQueueAdd.mock.calls[0][2].jobId).not.toBe(mockQueueAdd.mock.calls[1][2].jobId);
  });

  // Dedup still has to work for what it was for: the same delivery arriving
  // twice must not import the ride twice.
  it('gives an identical re-delivery the same id', async () => {
    await enqueueSyncJob('syncActivity', {
      userId: 'u1',
      provider: 'garmin',
      activityId: 'summary-456',
      pushedActivity: base,
    });
    await enqueueSyncJob('syncActivity', {
      userId: 'u1',
      provider: 'garmin',
      activityId: 'summary-456',
      // Same values, different key order: Garmin's serialization order must not
      // change the hash or every re-delivery would look like an edit.
      pushedActivity: {
        durationInSeconds: 5340,
        activityType: 'MOUNTAIN_BIKING',
        summaryId: 'summary-456',
      },
    });

    expect(mockQueueAdd.mock.calls[0][2].jobId).toBe(mockQueueAdd.mock.calls[1][2].jobId);
  });

  // Samples are excluded from the hash, so a re-delivery carrying the track
  // still dedupes against one that did not.
  it('ignores samples when discriminating', async () => {
    await enqueueSyncJob('syncActivity', {
      userId: 'u1',
      provider: 'garmin',
      activityId: 'summary-456',
      pushedActivity: base,
    });
    await enqueueSyncJob('syncActivity', {
      userId: 'u1',
      provider: 'garmin',
      activityId: 'summary-456',
      pushedActivity: { ...base, samples: [{ latitudeInDegree: 48.75 }] },
    });

    expect(mockQueueAdd.mock.calls[0][2].jobId).toBe(mockQueueAdd.mock.calls[1][2].jobId);
  });

  // BullMQ 5 absorbs a duplicate instead of throwing, so without the lookup a
  // dropped job reported itself as queued.
  it('reports already_queued when the job exists, and adds nothing', async () => {
    mockQueueGetJob.mockResolvedValue({ id: 'existing' });

    const result = await enqueueSyncJob('syncActivity', {
      userId: 'u1',
      provider: 'garmin',
      activityId: 'summary-456',
      pushedActivity: base,
    });

    expect(result.status).toBe('already_queued');
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });
});

describe('enqueueSyncJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the singleton
    closeSyncQueue();
    mockQueueAdd.mockResolvedValue({});
    mockQueueGetJob.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await closeSyncQueue();
  });

  it('should return queued status for new job', async () => {
    const data: SyncJobData = { userId: 'user123', provider: 'strava' };

    const result = await enqueueSyncJob('syncLatest', data);

    expect(result).toEqual({
      status: 'queued',
      jobId: 'syncLatest_strava_user123',
    });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'syncLatest',
      data,
      { jobId: 'syncLatest_strava_user123' }
    );
  });

  it('should return already_queued status for duplicate job', async () => {
    mockQueueAdd.mockRejectedValue(new Error('Job syncLatest_strava_user123 already exists'));

    const data: SyncJobData = { userId: 'user123', provider: 'strava' };

    const result = await enqueueSyncJob('syncLatest', data);

    expect(result).toEqual({
      status: 'already_queued',
      jobId: 'syncLatest_strava_user123',
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

    expect(result.jobId).toBe('syncActivity_garmin_user123_act456');
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'syncActivity',
      data,
      { jobId: 'syncActivity_garmin_user123_act456' }
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
