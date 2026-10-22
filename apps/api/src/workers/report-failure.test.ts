import * as Sentry from '@sentry/node';
import { UnrecoverableError } from 'bullmq';
import { reportWorkerFailure } from './report-failure';

jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

const mockCapture = Sentry.captureException as jest.MockedFunction<typeof Sentry.captureException>;
const mockCaptureMessage = Sentry.captureMessage as jest.MockedFunction<typeof Sentry.captureMessage>;

/** The lift worker's deferral: Overpass unreachable, job handed back to BullMQ. */
function geometryUnavailable(): Error {
  const err = new Error('Lift geometry unavailable for ride ride-1; deferring rather than storing a kinematic-only result');
  err.name = 'GeometryUnavailableError';
  return err;
}

/** A BullMQ job as this helper sees it. */
function job(overrides: Partial<{
  id: string;
  name: string;
  attemptsMade: number;
  attempts: number;
  data: unknown;
}> = {}) {
  return {
    id: overrides.id ?? 'job-1',
    name: overrides.name ?? 'syncActivity',
    attemptsMade: overrides.attemptsMade ?? 1,
    opts: { attempts: overrides.attempts ?? 5 },
    data: 'data' in overrides ? overrides.data : { userId: 'rider-1', provider: 'garmin' },
  };
}

describe('reportWorkerFailure', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * The whole point of the helper. BullMQ emits `failed` once per attempt, so a
   * five-attempt job used to ship five copies of one failure: 646 Sentry events
   * for roughly 129 real deliveries.
   */
  describe('one report per job, not one per attempt', () => {
    it.each([1, 2, 3, 4])('stays silent on attempt %i of 5', (attemptsMade) => {
      reportWorkerFailure('sync', job({ attemptsMade }), new Error('boom'));

      expect(mockCapture).not.toHaveBeenCalled();
    });

    it('reports on the final attempt', () => {
      reportWorkerFailure('sync', job({ attemptsMade: 5 }), new Error('boom'));

      expect(mockCapture).toHaveBeenCalledTimes(1);
    });

    it('reports once across a full retry sequence', () => {
      const err = new Error('boom');
      for (let attemptsMade = 1; attemptsMade <= 5; attemptsMade++) {
        reportWorkerFailure('sync', job({ attemptsMade }), err);
      }

      expect(mockCapture).toHaveBeenCalledTimes(1);
    });

    // A queue that never retries: the first attempt is also the last one.
    it('reports immediately when the job has a single attempt', () => {
      reportWorkerFailure('sync', job({ attemptsMade: 1, attempts: 1 }), new Error('boom'));

      expect(mockCapture).toHaveBeenCalledTimes(1);
    });

    // BullMQ can emit `failed` with no job at all, and dropping it would lose
    // the error entirely.
    it('reports when there is no job to count attempts on', () => {
      reportWorkerFailure('sync', undefined, new Error('boom'));

      expect(mockCapture).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * UnrecoverableError ends a job on the spot, with attempts still on the clock,
   * so counting attempts alone would file it as "not final yet" and drop it.
   * That is the failure mode this branch exists to prevent.
   */
  /**
   * An Overpass outage is the deferral working as designed. Fifty rides that
   * gave up should read as one warning with fifty events, not fifty errors.
   */
  describe('geometry unavailable', () => {
    it('records the final give-up as a warning message, not an exception', () => {
      reportWorkerFailure('lift', job({ name: 'detectLifts', attemptsMade: 3, attempts: 3 }), geometryUnavailable());

      expect(mockCapture).not.toHaveBeenCalled();
      expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
      const [message, context] = mockCaptureMessage.mock.calls[0];
      expect(message).toBe('Lift geometry unavailable; job gave up after retries');
      expect(context).toMatchObject({
        level: 'warning',
        tags: { worker: 'lift', jobName: 'detectLifts' },
        extra: { jobId: 'job-1', attemptsMade: 3, attempts: 3 },
      });
    });

    it('stays silent on the attempts before the last', () => {
      reportWorkerFailure('lift', job({ attemptsMade: 1, attempts: 3 }), geometryUnavailable());

      expect(mockCapture).not.toHaveBeenCalled();
      expect(mockCaptureMessage).not.toHaveBeenCalled();
    });
  });

  describe('unrecoverable failures', () => {
    it('reports on the first attempt', () => {
      reportWorkerFailure(
        'backfill',
        job({ attemptsMade: 1, attempts: 5 }),
        new UnrecoverableError('Garmin not connected')
      );

      expect(mockCapture).toHaveBeenCalledTimes(1);
    });

    // Matched by name, not instanceof, so it survives crossing a module or
    // process boundary where the class identity does not.
    it('reports an error that merely carries the name', () => {
      const err = new Error('Garmin credentials will not decrypt');
      err.name = 'UnrecoverableError';

      reportWorkerFailure('sync', job({ attemptsMade: 1 }), err);

      expect(mockCapture).toHaveBeenCalledTimes(1);
    });
  });

  describe('what gets attached', () => {
    it('puts the rider in user context so Sentry can count them', () => {
      reportWorkerFailure('sync', job({ attemptsMade: 5 }), new Error('boom'));

      expect(mockCapture).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ user: { id: 'rider-1' } })
      );
    });

    it('tags the worker, job name and provider', () => {
      reportWorkerFailure('sync', job({ attemptsMade: 5 }), new Error('boom'));

      expect(mockCapture).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          tags: expect.objectContaining({
            worker: 'sync',
            jobName: 'syncActivity',
            provider: 'garmin',
          }),
        })
      );
    });

    // Not every queue carries a rider, and an absent one must not become the
    // string "undefined" in Sentry's user context.
    it('omits user context when the payload names no rider', () => {
      reportWorkerFailure('weather', job({ attemptsMade: 5, data: { rideId: 'ride-1' } }), new Error('boom'));

      const [, options] = mockCapture.mock.calls[0];
      expect(options).toMatchObject({ user: undefined });
    });

    it('survives a payload that is not an object at all', () => {
      reportWorkerFailure('lift', job({ attemptsMade: 5, data: undefined }), new Error('boom'));

      expect(mockCapture).toHaveBeenCalledTimes(1);
      const [, options] = mockCapture.mock.calls[0];
      expect(options).toMatchObject({ user: undefined });
    });
  });
});
