import { Router as createRouter, type Router, type Request, type Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { prisma } from '../lib/prisma';
import { createLogger, logError } from '../lib/logger';
import { isActiveSource } from '../lib/active-source';
import { isSuuntoCyclingActivity, getSuuntoRideType } from '../types/suunto';
import { syncBikeComponentHours } from '../lib/component-hours';

const log = createLogger('suunto-webhook');
const r: Router = createRouter();

// ---------------------------------------------------------------------------
// Webhook receiver
// ---------------------------------------------------------------------------
// Mounted in server.ts at `/webhooks/suunto` with `express.raw()` so that
// `req.body` is the raw Buffer needed for HMAC-SHA256 signature verification.
//
// Suunto webhook contract (from API docs):
//   - Header: `X-HMAC-SHA256-Signature` = hex(HMAC-SHA256(body, NOTIFICATION_SECRET))
//   - Body: JSON `{ type, username, ...payload }`. Type discriminates between
//     WORKOUT_CREATED, ROUTE_CREATED, and three SUUNTO_247_* variants.
//   - Must respond 2xx within 2s or Suunto retries with backoff and may trip
//     a circuit breaker that pauses all notifications for the app.
//
// We currently only process WORKOUT_CREATED — Loam Logger is a ride tracker
// and the other notification types (routes, 24/7 metrics) are out of scope.
// The other URLs aren't registered in the Suunto portal, so they shouldn't
// arrive in practice; logging them as "ignored" keeps the receiver robust if
// the portal config changes.
// ---------------------------------------------------------------------------

type WorkoutCreatedEvent = {
  type: 'WORKOUT_CREATED';
  username: string;
  workout: {
    workoutKey: string;
    activityId: number;
    startTime: number; // Unix epoch ms
    totalTime: number; // seconds
    energyConsumption?: number;
    startPosition?: { x: number; y: number }; // x = longitude, y = latitude
    stepCount?: number;
    totalAscent?: number;
    totalDescent?: number;
    totalDistance?: number; // meters
    hrdata?: { workoutAvgHR?: number; workoutMaxHR?: number };
    avgSpeed?: number;
    maxSpeed?: number;
    timeOffsetInMinutes?: number;
  };
  gear?: {
    manufacturer?: string;
    name?: string;
    productType?: string;
  };
};

type SuuntoWebhookEvent =
  | WorkoutCreatedEvent
  | { type: 'ROUTE_CREATED'; username: string; [k: string]: unknown }
  | { type: 'SUUNTO_247_ACTIVITY_CREATED'; username: string; [k: string]: unknown }
  | { type: 'SUUNTO_247_SLEEP_CREATED'; username: string; [k: string]: unknown }
  | { type: 'SUUNTO_247_RECOVERY_CREATED'; username: string; [k: string]: unknown };

function verifySignature(rawBody: Buffer, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader) return false;
  const computed = createHmac('sha256', secret).update(rawBody).digest('hex');
  let provided: Buffer;
  try {
    provided = Buffer.from(signatureHeader, 'hex');
  } catch {
    return false;
  }
  const expected = Buffer.from(computed, 'hex');
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

r.post('/workouts', async (req: Request, res: Response) => {
  const rawBody = req.body as Buffer;
  const signature = req.header('X-HMAC-SHA256-Signature');
  const secret = process.env.SUUNTO_NOTIFICATION_SECRET;

  if (!secret) {
    log.error('SUUNTO_NOTIFICATION_SECRET not set');
    return res.status(500).send('server misconfigured');
  }

  if (!Buffer.isBuffer(rawBody) || !verifySignature(rawBody, signature, secret)) {
    log.warn({ hasSig: !!signature, bodyType: typeof rawBody }, 'Suunto webhook: signature mismatch');
    return res.status(403).send('forbidden');
  }

  let event: SuuntoWebhookEvent;
  try {
    event = JSON.parse(rawBody.toString('utf-8')) as SuuntoWebhookEvent;
  } catch (err) {
    log.warn({ err }, 'Suunto webhook: invalid JSON');
    return res.status(400).send('invalid json');
  }

  // Respond immediately so we beat Suunto's 2s deadline.
  res.status(200).send('OK');

  try {
    switch (event.type) {
      case 'WORKOUT_CREATED':
        await processWorkoutCreated(event);
        break;
      default:
        log.info({ type: event.type, username: event.username }, 'Suunto event ignored (not subscribed)');
    }
  } catch (err) {
    logError('Suunto webhook processing', err);
  }
});

async function processWorkoutCreated(event: WorkoutCreatedEvent): Promise<void> {
  const { username, workout } = event;

  const userAccount = await prisma.userAccount.findUnique({
    where: { provider_providerUserId: { provider: 'suunto', providerUserId: username } },
  });

  if (!userAccount) {
    log.warn({ username }, 'Suunto webhook: unknown username');
    return;
  }

  if (!await isActiveSource(userAccount.userId, 'suunto')) {
    log.info({ userId: userAccount.userId }, 'Suunto webhook: user active source is not Suunto, skipping');
    return;
  }

  if (!isSuuntoCyclingActivity(workout.activityId)) {
    log.info(
      { userId: userAccount.userId, activityId: workout.activityId, workoutKey: workout.workoutKey },
      'Suunto webhook: non-cycling activity, skipping'
    );
    return;
  }

  const startTime = new Date(workout.startTime);
  const distanceMeters = workout.totalDistance ?? 0;
  const elevationGainMeters = workout.totalAscent ?? 0;
  const startLat = workout.startPosition?.y ?? null;
  const startLng = workout.startPosition?.x ?? null;
  const averageHr = workout.hrdata?.workoutAvgHR != null
    ? Math.round(workout.hrdata.workoutAvgHR)
    : null;
  const rideType = getSuuntoRideType(workout.activityId);

  // Read existing ride before upsert so we can diff bikeId/duration into
  // component hours. A missing record means this is a new ride; in that
  // case we also auto-assign the user's single active bike to keep webhook
  // behavior aligned with the sync worker and backfill paths.
  const existing = await prisma.ride.findUnique({
    where: { suuntoWorkoutId: workout.workoutKey },
    select: { id: true, durationSeconds: true, bikeId: true },
  });

  const isNewRide = !existing;
  let bikeId: string | null = null;
  if (isNewRide) {
    const userBikes = await prisma.bike.findMany({
      where: { userId: userAccount.userId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (userBikes.length === 1) {
      bikeId = userBikes[0].id;
    }
  }

  await prisma.$transaction(async (tx) => {
    const ride = await tx.ride.upsert({
      where: { suuntoWorkoutId: workout.workoutKey },
      create: {
        userId: userAccount.userId,
        suuntoWorkoutId: workout.workoutKey,
        startTime,
        durationSeconds: workout.totalTime,
        distanceMeters,
        elevationGainMeters,
        averageHr,
        rideType,
        bikeId,
        startLat,
        startLng,
      },
      update: {
        startTime,
        durationSeconds: workout.totalTime,
        distanceMeters,
        elevationGainMeters,
        averageHr,
        rideType,
        ...(startLat != null ? { startLat } : {}),
        ...(startLng != null ? { startLng } : {}),
      },
    });

    await syncBikeComponentHours(
      tx,
      userAccount.userId,
      { bikeId: existing?.bikeId ?? null, durationSeconds: existing?.durationSeconds ?? null },
      { bikeId: ride.bikeId ?? null, durationSeconds: ride.durationSeconds }
    );
  });

  log.info({ userId: userAccount.userId, workoutKey: workout.workoutKey, activityId: workout.activityId, isNewRide }, 'Suunto workout upserted');
}

export default r;
