import type { PrismaClient, Prisma } from '@prisma/client';

type TransactionClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

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
