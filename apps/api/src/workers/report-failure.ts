import * as Sentry from '@sentry/node';

/**
 * The parts of a BullMQ job this needs, structurally typed.
 *
 * Deliberately not `Job<T>`: the five workers carry five different data shapes,
 * and naming the concrete type here would either force a cast at each call site
 * or drag every queue's payload type into this module. Nothing below reads more
 * than these fields.
 */
type ReportableJob = {
  id?: string;
  name?: string;
  attemptsMade: number;
  opts: { attempts?: number };
  data?: unknown;
};

/** Pull the rider off a job payload without assuming any one queue's shape. */
function riderId(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const { userId } = data as { userId?: unknown };
  return typeof userId === 'string' && userId ? userId : undefined;
}

function providerTag(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const { provider } = data as { provider?: unknown };
  return typeof provider === 'string' && provider ? provider : undefined;
}

/**
 * Report a job failure to Sentry once, when the job is actually finished.
 *
 * BullMQ emits `failed` on every attempt, so a queue configured for five
 * retries used to ship five copies of one failure. That is how a single Garmin
 * integration problem reached 646 events: roughly 129 real deliveries, each
 * counted five times. The retries in between are the queue working as designed,
 * not five incidents.
 *
 * `UnrecoverableError` ends a job early, with attempts still on the clock, so it
 * is matched by name rather than being silently filtered out by the attempt
 * count. Matching by name rather than `instanceof` keeps this working when the
 * error crosses a module boundary or arrives deserialized from a sandboxed
 * processor.
 *
 * The rider goes in Sentry's `user` context rather than a tag because that is
 * what Sentry counts "users impacted" from. Without it, every worker issue
 * reports zero no matter how many riders hit it.
 */
export function reportWorkerFailure(
  workerName: string,
  job: ReportableJob | undefined,
  err: Error
): void {
  const attempts = job?.opts.attempts ?? 1;
  const isFinalAttempt = !job || job.attemptsMade >= attempts;

  if (!isFinalAttempt && err.name !== 'UnrecoverableError') return;

  const userId = riderId(job?.data);

  // A lift job that gave up because Overpass was unreachable is the deferral
  // working as designed (lib/lift-detection GeometryUnavailableError), not a
  // defect, so it goes in as one warning-level message rather than an error
  // per ride. A batch of fifty refused rides is then one issue with fifty
  // events, visible but not paging anyone. Matched by name for the same
  // reason UnrecoverableError is above.
  if (err.name === 'GeometryUnavailableError') {
    Sentry.captureMessage('Lift geometry unavailable; job gave up after retries', {
      level: 'warning',
      tags: { worker: workerName, jobName: job?.name },
      extra: { jobId: job?.id, attemptsMade: job?.attemptsMade, attempts, message: err.message },
    });
    return;
  }

  Sentry.captureException(err, {
    tags: {
      worker: workerName,
      jobName: job?.name,
      provider: providerTag(job?.data),
    },
    user: userId ? { id: userId } : undefined,
    extra: { jobId: job?.id, attemptsMade: job?.attemptsMade, attempts },
  });
}
