// Mock connection first (before any imports that use it)
jest.mock('./connection', () => ({
  getQueueConnection: jest.fn(() => ({ connection: { host: 'localhost', port: 6379 } })),
}));

const mockQueueAdd = jest.fn();
const mockQueueClose = jest.fn().mockResolvedValue(undefined);
const mockQueueGetJob = jest.fn();

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    close: mockQueueClose,
    getJob: mockQueueGetJob,
  })),
}));

import { buildLiftJobId, closeLiftQueue, enqueueLiftDetectionJob } from './lift.queue';

const RIDE_ID = 'ride-1';

describe('enqueueLiftDetectionJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueueAdd.mockResolvedValue({ id: buildLiftJobId(RIDE_ID) });
  });

  afterAll(async () => {
    await closeLiftQueue();
  });

  it('queues a job under the ride-keyed id when none exists', async () => {
    mockQueueGetJob.mockResolvedValueOnce(null);

    const result = await enqueueLiftDetectionJob({ rideId: RIDE_ID });

    expect(result).toEqual({ status: 'queued', jobId: 'detectLifts_ride-1' });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'detectLifts',
      { rideId: RIDE_ID },
      { jobId: 'detectLifts_ride-1' }
    );
  });

  it('reports already_queued, and adds nothing, while a job for the ride is waiting or active', async () => {
    for (const state of ['waiting', 'prioritized', 'active', 'delayed']) {
      const remove = jest.fn();
      mockQueueGetJob.mockResolvedValueOnce({ getState: jest.fn().mockResolvedValue(state), remove });

      const result = await enqueueLiftDetectionJob({ rideId: RIDE_ID });

      expect(result).toEqual({ status: 'already_queued', jobId: 'detectLifts_ride-1' });
      expect(remove).not.toHaveBeenCalled();
    }
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it('removes a completed or failed job under the id before re-adding, so a recent ride can be re-analyzed', async () => {
    // BullMQ ignores an add whose id still exists in the completed or failed
    // set; without the removal a force re-analysis of a recently analyzed
    // ride would silently do nothing.
    for (const state of ['completed', 'failed']) {
      const remove = jest.fn().mockResolvedValue(undefined);
      mockQueueGetJob.mockResolvedValueOnce({ getState: jest.fn().mockResolvedValue(state), remove });

      const result = await enqueueLiftDetectionJob({ rideId: RIDE_ID });

      expect(result.status).toBe('queued');
      expect(remove).toHaveBeenCalledTimes(1);
      // Removal precedes the add.
      expect(remove.mock.invocationCallOrder[0]).toBeLessThan(
        mockQueueAdd.mock.invocationCallOrder.at(-1) as number
      );
    }
    expect(mockQueueAdd).toHaveBeenCalledTimes(2);
  });

  it('puts a geometry-required job on the slow retry schedule and carries the flag in its data', async () => {
    mockQueueGetJob.mockResolvedValueOnce(null);

    await enqueueLiftDetectionJob({ rideId: RIDE_ID, requireGeometry: true });

    // Three attempts a minute and then two minutes apart: Overpass asks a
    // client that saw a 429 to wait at least 30 seconds, and the queue's
    // default 10 second backoff would only add to the load it is shedding.
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'detectLifts',
      { rideId: RIDE_ID, requireGeometry: true },
      {
        jobId: 'detectLifts_ride-1',
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
      }
    );
  });
});
