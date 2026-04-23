import type { PrismaClient, Prisma } from '@prisma/client';

type TransactionClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

const secondsToHours = (seconds: number | null | undefined) => Math.max(0, seconds ?? 0) / 3600;

/**
 * Increment hoursUsed for all currently-installed components on a bike.
 * Skips if hoursDelta is zero or negative.
 */
export async function incrementBikeComponentHours(
  tx: TransactionClient | Prisma.TransactionClient,
  opts: { userId: string; bikeId: string; hoursDelta: number }
) {
  if (opts.hoursDelta <= 0) return;
  await (tx as TransactionClient).component.updateMany({
    where: { userId: opts.userId, bikeId: opts.bikeId },
    data: { hoursUsed: { increment: opts.hoursDelta } },
  });
}

/**
 * Decrement hoursUsed for all currently-installed components on a bike.
 * Floors hoursUsed at zero to prevent negative values.
 * Skips if hoursDelta is zero or negative.
 */
export async function decrementBikeComponentHours(
  tx: TransactionClient | Prisma.TransactionClient,
  opts: { userId: string; bikeId: string; hoursDelta: number }
) {
  if (opts.hoursDelta <= 0) return;
  await (tx as TransactionClient).component.updateMany({
    where: { userId: opts.userId, bikeId: opts.bikeId },
    data: { hoursUsed: { decrement: opts.hoursDelta } },
  });
  // Floor at zero
  await (tx as TransactionClient).component.updateMany({
    where: { userId: opts.userId, bikeId: opts.bikeId, hoursUsed: { lt: 0 } },
    data: { hoursUsed: 0 },
  });
}

/**
 * Diff-based sync of component hours across an upsert.
 *
 * Given the previous (bikeId, durationSeconds) and next state of a ride,
 * credit/debit component hours correctly:
 *  - Bike changed: decrement the old bike's components by the full previous
 *    duration, increment the new bike's components by the full new duration.
 *  - Same bike, longer ride: increment by the delta.
 *  - Same bike, shorter ride: decrement by the absolute delta.
 *  - No bike on either side: no-op.
 *
 * Previously duplicated inline in [webhooks.strava.ts] and [workers/sync.worker.ts].
 */
export async function syncBikeComponentHours(
  tx: Prisma.TransactionClient,
  userId: string,
  previous: { bikeId: string | null; durationSeconds: number | null | undefined },
  next: { bikeId: string | null; durationSeconds: number | null | undefined }
): Promise<void> {
  const prevBikeId = previous.bikeId;
  const nextBikeId = next.bikeId;
  const prevHours = secondsToHours(previous.durationSeconds);
  const nextHours = secondsToHours(next.durationSeconds);
  const bikeChanged = prevBikeId !== nextBikeId;
  const hoursDiff = nextHours - prevHours;

  if (prevBikeId) {
    if (bikeChanged) {
      await decrementBikeComponentHours(tx, { userId, bikeId: prevBikeId, hoursDelta: prevHours });
    } else if (hoursDiff < 0) {
      await decrementBikeComponentHours(tx, { userId, bikeId: prevBikeId, hoursDelta: Math.abs(hoursDiff) });
    }
  }

  if (nextBikeId) {
    if (bikeChanged) {
      await incrementBikeComponentHours(tx, { userId, bikeId: nextBikeId, hoursDelta: nextHours });
    } else if (hoursDiff > 0) {
      await incrementBikeComponentHours(tx, { userId, bikeId: nextBikeId, hoursDelta: hoursDiff });
    }
  }
}
