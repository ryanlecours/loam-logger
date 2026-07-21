// Shared Garmin backfill trigger.
//
// Garmin's Wellness API doesn't allow arbitrary re-reads of historical activity
// data — the compliant way to re-fetch a date range is the async backfill
// endpoint (`/rest/backfill/activities`). Garmin then re-delivers each activity
// via the activities-ping webhook, which runs processGarminCallback. That
// callback path upserts the ride (extracting coords via extractGarminStartCoords
// and enqueueing weather), so a backfill is also how we repair already-imported
// rides that are missing coordinates.
//
// This module owns the chunked-trigger loop shared by the user-facing backfill
// route and the coord-repair maintenance script, so the 30-day chunking and
// 202/409/400 handling live in exactly one place.
import { logError, logger } from '../lib/logger';

// Garmin's backfill endpoint accepts at most a 30-day window per request.
const CHUNK_DAYS = 30;

const resolveApiBase = (override?: string): string =>
  override ?? process.env.GARMIN_API_BASE ?? 'https://apis.garmin.com/wellness-api';

export type GarminBackfillTriggerResult = {
  /** Chunks Garmin accepted (HTTP 202). */
  totalChunks: number;
  /** Human-readable notes for skipped/failed chunks (duplicates, errors). */
  errors: string[];
  /** True when every chunk was a 409 duplicate — the range was already backfilled. */
  allDuplicates: boolean;
};

/**
 * Extract the minimum start date from a Garmin 400 error. When a backfill
 * request reaches too far into the past, Garmin replies with e.g.
 * "summaryStartTimeInSeconds must be greater than or equal to min start time of
 * 2023-01-15T00:00:00Z". We parse that so the caller can retry from the allowed
 * boundary instead of failing the whole backfill.
 */
export function extractMinStartDate(errorText: string): Date | null {
  try {
    const parsed = JSON.parse(errorText);
    const message =
      typeof parsed?.errorMessage === 'string' ? parsed.errorMessage : String(parsed ?? '');
    const match = message.match(/min start time of ([0-9T:.-]+Z)/i);
    if (match && match[1]) {
      const dt = new Date(match[1]);
      if (!Number.isNaN(dt.getTime())) {
        return dt;
      }
    }
  } catch {
    // ignore JSON parse errors and fall through
  }
  return null;
}

/**
 * Trigger Garmin's async backfill for [startDate, endDate) in 30-day chunks.
 * Fire-and-forget from Garmin's side: on success (202) the activities arrive
 * later via webhooks. Never throws for per-chunk failures — they're collected
 * in `errors` so the caller can decide how to surface them.
 */
export async function triggerGarminBackfillChunks(opts: {
  accessToken: string;
  startDate: Date;
  endDate: Date;
  apiBase?: string;
  /**
   * Delay inserted before every request after the first. Garmin rate-limits
   * backfill per user (~100/min), so background callers (the coord-repair
   * worker) pace themselves; the interactive route leaves this at 0.
   */
  delayBetweenChunksMs?: number;
}): Promise<GarminBackfillTriggerResult> {
  const apiBase = resolveApiBase(opts.apiBase);
  const { accessToken, endDate } = opts;
  const delayMs = opts.delayBetweenChunksMs ?? 0;

  let currentStartDate = new Date(opts.startDate);
  let totalChunks = 0;
  let requestsMade = 0;
  const errors: string[] = [];

  while (currentStartDate < endDate) {
    // Throttle: pause before each request after the first to stay under
    // Garmin's per-user rate limit.
    if (delayMs > 0 && requestsMade > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    // Chunk end is 30 days out, clamped to the overall end date.
    const chunkEndDate = new Date(currentStartDate);
    chunkEndDate.setDate(chunkEndDate.getDate() + CHUNK_DAYS);
    const actualChunkEndDate = chunkEndDate > endDate ? endDate : chunkEndDate;

    const chunkStartSeconds = Math.floor(currentStartDate.getTime() / 1000);
    const chunkEndSeconds = Math.floor(actualChunkEndDate.getTime() / 1000);

    const url = `${apiBase}/rest/backfill/activities?summaryStartTimeInSeconds=${chunkStartSeconds}&summaryEndTimeInSeconds=${chunkEndSeconds}`;

    // Advance to the next chunk unless a min-start rejection tells us to retry
    // this chunk from an adjusted (later) start date.
    let advanceToNextChunk = true;

    try {
      const backfillRes = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (backfillRes.status === 202) {
        logger.info({ chunk: totalChunks + 1 }, 'Garmin backfill request accepted');
        totalChunks++;
      } else if (backfillRes.status === 409) {
        // Garmin already fulfilled this range; it won't re-send the activities.
        logger.warn(
          { startDate: currentStartDate.toISOString().split('T')[0] },
          'Garmin backfill already completed for this time period'
        );
        errors.push(`Duplicate request for period ${currentStartDate.toISOString().split('T')[0]}`);
      } else if (backfillRes.status === 400) {
        const text = await backfillRes.text();
        const minStartDate = extractMinStartDate(text);
        if (minStartDate && minStartDate > currentStartDate) {
          logger.warn(
            { originalStart: currentStartDate.toISOString(), adjustedStart: minStartDate.toISOString() },
            'Garmin backfill chunk rejected, adjusting to minimum start date and retrying'
          );
          errors.push(
            `Adjusted start date to ${minStartDate.toISOString()} due to Garmin min start restriction`
          );
          const alignedMinStart = new Date(Math.ceil(minStartDate.getTime() / 1000) * 1000);
          currentStartDate = alignedMinStart;
          advanceToNextChunk = false; // Retry with the adjusted date
        } else {
          logger.error({ status: backfillRes.status, response: text }, 'Garmin backfill chunk failed');
          errors.push(
            `Failed for period ${currentStartDate.toISOString().split('T')[0]}: ${backfillRes.status}`
          );
        }
      } else {
        const text = await backfillRes.text();
        logger.error({ status: backfillRes.status, response: text }, 'Garmin backfill chunk failed');
        errors.push(`Failed for period ${currentStartDate.toISOString().split('T')[0]}: ${backfillRes.status}`);
      }
    } catch (error) {
      logError('Garmin Backfill chunk', error);
      errors.push(`Error for period ${currentStartDate.toISOString().split('T')[0]}`);
    }

    requestsMade++;

    // Next chunk starts where this one ended (1-second overlap; Garmin dedupes
    // by activity ID) unless we're retrying with an adjusted start date.
    if (advanceToNextChunk) {
      currentStartDate = new Date(actualChunkEndDate);
    }
  }

  const duplicateErrors = errors.filter((e) => e.includes('Duplicate request'));
  const allDuplicates = duplicateErrors.length === errors.length && errors.length > 0;

  return { totalChunks, errors, allDuplicates };
}
