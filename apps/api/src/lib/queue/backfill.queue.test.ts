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
const mockQueueGetJob = jest.fn();

// Mock bullmq
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    close: mockQueueClose,
    getJob: mockQueueGetJob,
  })),
}));

jest.mock('../logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import {
  buildBackfillJobId,
  buildCallbackJobId,
  buildCoordRepairJobId,
  enqueueBackfillJob,
  enqueueCallbackJob,
  enqueueGarminCoordRepairJob,
  getBackfillQueue,
  closeBackfillQueue,
} from './backfill.queue';
import type { BackfillJobData } from './backfill.queue';

describe('buildBackfillJobId', () => {
  it('should build ID for garmin backfillYear', () => {
    const result = buildBackfillJobId('garmin', 'user123', '2024');
    expect(result).toBe('backfillYear_garmin_user123_2024');
  });

  it('should build ID for ytd year', () => {
    const result = buildBackfillJobId('garmin', 'user456', 'ytd');
    expect(result).toBe('backfillYear_garmin_user456_ytd');
  });

  it('should handle different user IDs', () => {
    const result1 = buildBackfillJobId('garmin', 'user-abc-123', '2023');
    const result2 = buildBackfillJobId('garmin', 'user-xyz-789', '2023');

    expect(result1).toBe('backfillYear_garmin_user-abc-123_2023');
    expect(result2).toBe('backfillYear_garmin_user-xyz-789_2023');
    expect(result1).not.toBe(result2);
  });
});

describe('buildCallbackJobId', () => {
  it('should build ID with MD5 hash of callback URL', () => {
    const result = buildCallbackJobId(
      'garmin',
      'user123',
      'https://apis.garmin.com/callback/xyz'
    );

    expect(result).toMatch(/^processCallback_garmin_user123_[a-f0-9]{12}$/);
  });

  it('should produce different IDs for different callback URLs', () => {
    const result1 = buildCallbackJobId('garmin', 'user123', 'https://apis.garmin.com/callback/1');
    const result2 = buildCallbackJobId('garmin', 'user123', 'https://apis.garmin.com/callback/2');

    expect(result1).not.toBe(result2);
  });

  it('should produce same ID for same callback URL (idempotent)', () => {
    const url = 'https://apis.garmin.com/callback/same-url';
    const result1 = buildCallbackJobId('garmin', 'user123', url);
    const result2 = buildCallbackJobId('garmin', 'user123', url);

    expect(result1).toBe(result2);
  });

  it('should produce different IDs for different users with same URL', () => {
    const url = 'https://apis.garmin.com/callback/shared';
    const result1 = buildCallbackJobId('garmin', 'user1', url);
    const result2 = buildCallbackJobId('garmin', 'user2', url);

    expect(result1).not.toBe(result2);
  });
});

describe('enqueueBackfillJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the singleton
    closeBackfillQueue();
    mockQueueAdd.mockResolvedValue({});
  });

  afterEach(async () => {
    await closeBackfillQueue();
  });

  it('should return queued status for new job', async () => {
    const data: BackfillJobData = {
      userId: 'user123',
      provider: 'garmin',
      year: '2024',
    };

    const result = await enqueueBackfillJob(data);

    expect(result).toEqual({
      status: 'queued',
      jobId: 'backfillYear_garmin_user123_2024',
    });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'backfillYear',
      data,
      { jobId: 'backfillYear_garmin_user123_2024' }
    );
  });

  it('should return already_queued status for duplicate job', async () => {
    mockQueueAdd.mockRejectedValue(
      new Error('Job backfillYear_garmin_user123_2024 already exists')
    );

    const data: BackfillJobData = {
      userId: 'user123',
      provider: 'garmin',
      year: '2024',
    };

    const result = await enqueueBackfillJob(data);

    expect(result).toEqual({
      status: 'already_queued',
      jobId: 'backfillYear_garmin_user123_2024',
    });
  });

  it('should rethrow unexpected errors', async () => {
    mockQueueAdd.mockRejectedValue(new Error('Redis connection failed'));

    const data: BackfillJobData = {
      userId: 'user123',
      provider: 'garmin',
      year: '2024',
    };

    await expect(enqueueBackfillJob(data)).rejects.toThrow('Redis connection failed');
  });
});

describe('enqueueCallbackJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    closeBackfillQueue();
    mockQueueAdd.mockResolvedValue({});
  });

  afterEach(async () => {
    await closeBackfillQueue();
  });

  it('should return queued status for new callback job', async () => {
    const data = {
      userId: 'user123',
      provider: 'garmin' as const,
      callbackURL: 'https://apis.garmin.com/callback/xyz',
    };

    const result = await enqueueCallbackJob(data);

    expect(result.status).toBe('queued');
    expect(result.jobId).toMatch(/^processCallback_garmin_user123_[a-f0-9]{12}$/);
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'processCallback',
      data,
      { jobId: expect.stringMatching(/^processCallback_garmin_user123_[a-f0-9]{12}$/) }
    );
  });

  it('should return already_queued status for duplicate callback job', async () => {
    mockQueueAdd.mockRejectedValue(
      new Error('Job processCallback_garmin_user123_abc123def456 already exists')
    );

    const data = {
      userId: 'user123',
      provider: 'garmin' as const,
      callbackURL: 'https://apis.garmin.com/callback/xyz',
    };

    const result = await enqueueCallbackJob(data);

    expect(result.status).toBe('already_queued');
    expect(result.jobId).toMatch(/^processCallback_garmin_user123_[a-f0-9]{12}$/);
  });

  it('should rethrow unexpected errors for callback jobs', async () => {
    mockQueueAdd.mockRejectedValue(new Error('Queue unavailable'));

    const data = {
      userId: 'user123',
      provider: 'garmin' as const,
      callbackURL: 'https://apis.garmin.com/callback/xyz',
    };

    await expect(enqueueCallbackJob(data)).rejects.toThrow('Queue unavailable');
  });
});

describe('buildCoordRepairJobId', () => {
  it('builds a per-user id (one repair in flight per user)', () => {
    expect(buildCoordRepairJobId('user123')).toBe('repairGarminCoords_user123');
    expect(buildCoordRepairJobId('user-abc')).not.toBe(buildCoordRepairJobId('user-xyz'));
  });
});

describe('enqueueGarminCoordRepairJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    closeBackfillQueue();
    mockQueueAdd.mockResolvedValue({});
    mockQueueGetJob.mockResolvedValue(undefined); // no existing job by default
  });

  afterEach(async () => {
    await closeBackfillQueue();
  });

  it('queues a garmin-provider job under the per-user id when none exists', async () => {
    const result = await enqueueGarminCoordRepairJob({ userId: 'user123' });

    expect(result).toEqual({ status: 'queued', jobId: 'repairGarminCoords_user123' });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'repairGarminCoords',
      { userId: 'user123', provider: 'garmin' },
      { jobId: 'repairGarminCoords_user123' }
    );
  });

  it('reports already_queued when a prior repair is still active', async () => {
    mockQueueGetJob.mockResolvedValue({ getState: jest.fn().mockResolvedValue('active') });

    const result = await enqueueGarminCoordRepairJob({ userId: 'user123' });

    expect(result.status).toBe('already_queued');
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('removes a completed prior job and re-queues so repair can run again', async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    mockQueueGetJob.mockResolvedValue({
      getState: jest.fn().mockResolvedValue('completed'),
      remove,
    });

    const result = await enqueueGarminCoordRepairJob({ userId: 'user123' });

    expect(remove).toHaveBeenCalled();
    expect(result.status).toBe('queued');
    expect(mockQueueAdd).toHaveBeenCalled();
  });
});

describe('getBackfillQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    closeBackfillQueue();
  });

  afterEach(async () => {
    await closeBackfillQueue();
  });

  it('should return the same queue instance on subsequent calls', () => {
    const queue1 = getBackfillQueue();
    const queue2 = getBackfillQueue();

    expect(queue1).toBe(queue2);
  });
});

describe('closeBackfillQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should close the queue if it exists', async () => {
    // Initialize the queue
    getBackfillQueue();

    await closeBackfillQueue();

    expect(mockQueueClose).toHaveBeenCalled();
  });

  it('should be safe to call multiple times', async () => {
    await closeBackfillQueue();
    await closeBackfillQueue();
    // No error thrown
  });
});
