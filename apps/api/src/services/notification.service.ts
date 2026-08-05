import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import { expo } from '../lib/expo';
import { prisma } from '../lib/prisma';
import { logError, logger } from '../lib/logger';
import { enqueueReceiptCheck } from '../lib/queue/notification.queue';
import { generateBikePredictions } from './prediction';
import { canSeePredictions } from '../auth/tier-access';
import { formatComponentType } from '@loam/shared';
import type {
  RideSyncNotificationMode,
  ServiceNotificationMode,
  SubscriptionTier,
  UserRole,
} from '@prisma/client';

/**
 * Validates that a string is a well-formed Expo push token.
 * Delegates to the official Expo SDK check.
 */
export function isValidExpoPushToken(token: string): boolean {
  return Expo.isExpoPushToken(token);
}

type SendPushParams = {
  pushToken: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

/**
 * Send a push notification via Expo and return the receipt ticket ID (if successful).
 * Returns null if the send fails or the token is invalid.
 *
 * Exported for sibling notification services only (the weekly digest); it is
 * the raw primitive and enforces none of the gating (preferences, dedup,
 * burst windows) that makes the system trustworthy. Feature code should call
 * `fireRideNotifications` / `fireServiceDueForBike`, never this.
 */
export async function sendPushNotification({ pushToken, title, body, data }: SendPushParams): Promise<string | null> {
  if (!Expo.isExpoPushToken(pushToken)) {
    logger.warn({ pushToken }, '[notifications] Invalid Expo push token');
    return null;
  }

  const message: ExpoPushMessage = {
    to: pushToken,
    sound: 'default',
    title,
    body,
    data,
  };

  try {
    const tickets: ExpoPushTicket[] = await expo.sendPushNotificationsAsync([message]);
    const ticket = tickets[0];
    if (ticket.status === 'error') {
      logger.error({ message: ticket.message, details: ticket.details }, '[notifications] Push error');
      return null;
    }
    return ticket.id;
  } catch (error) {
    logError('sendPushNotification', error);
    return null;
  }
}

type NotificationUser = {
  expoPushToken: string;
  distanceUnit: string | null;
};

/**
 * At most one ride-sync push per user per window, regardless of why each
 * would have fired. This is the layer where multi-provider copies of the
 * same physical ride (up to four "Ride Synced" for one ride) and a watch
 * uploading a weekend's activities in one burst collapse to a single push.
 * Uniform on purpose: even the pick-bike variant obeys it, because a burst
 * of unassigned rides used to mean a burst of pick-bike pushes, and the
 * in-app unassigned-rides banner now carries that workload. Service-due
 * pushes have their own per-component dedup and are unaffected.
 */
const RIDE_PUSH_WINDOW_MS = 30 * 60 * 1000;

/** RIDE_UPLOADED window rows are only ever read within the window; anything
 *  older is dead weight, pruned opportunistically on each send. */
const RIDE_PUSH_ROW_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * True when a ride push went out recently enough that another would be noise.
 *
 * The check and the later record are not atomic; two workers ingesting
 * provider copies of the same ride concurrently can both pass and send two
 * pushes. That race loses nothing relative to the old behavior (which always
 * sent both) and a claim-row scheme like SERVICE_DUE's would need a
 * time-bucketed unique key to express "per window", so it is deliberately
 * left as a best-effort read.
 */
async function isRidePushBurstSuppressed(userId: string): Promise<boolean> {
  const recent = await prisma.notificationLog.findFirst({
    where: {
      userId,
      notificationType: 'RIDE_UPLOADED',
      sentAt: { gte: new Date(Date.now() - RIDE_PUSH_WINDOW_MS) },
    },
    select: { id: true },
  });
  return recent !== null;
}

async function recordRidePush(userId: string): Promise<void> {
  await prisma.notificationLog.create({
    data: { userId, notificationType: 'RIDE_UPLOADED' },
  });
  // Prune stale window rows so the table doesn't accrete one row per ride
  // forever. Best-effort: a failed prune only leaves rows the window query
  // already ignores by sentAt.
  await prisma.notificationLog.deleteMany({
    where: {
      userId,
      notificationType: 'RIDE_UPLOADED',
      sentAt: { lt: new Date(Date.now() - RIDE_PUSH_ROW_TTL_MS) },
    },
  });
}

/**
 * Send a notification when a ride is synced from an integration (Strava/Garmin/Whoop/Suunto).
 *
 * If `needsBikeAssignment` is true (unassigned ride on a multi-bike account),
 * the body is extended with a tap-to-pick prompt and `data.action = 'pickBike'`
 * is set so the mobile listener deep-links straight into the bike picker on
 * the ride detail screen.
 *
 * Pure compose-and-send: whether this push should go out at all
 * (rideSyncNotificationMode, burst window) is decided by
 * `fireRideNotifications`, which owns the user row and the window state.
 */
export async function notifyRideUploaded(params: {
  userId: string;
  rideId: string;
  durationSeconds: number;
  distanceMeters: number;
  bikeName?: string;
  needsBikeAssignment?: boolean;
  user: NotificationUser;
}): Promise<string | undefined> {
  const { rideId, durationSeconds, distanceMeters, bikeName, needsBikeAssignment, user } = params;

  const durationMin = Math.round(durationSeconds / 60);
  const isKm = user.distanceUnit === 'km';
  const distance = isKm
    ? (distanceMeters / 1000).toFixed(1)
    : (distanceMeters / 1609.344).toFixed(1);
  const unit = isKm ? 'km' : 'mi';

  const bikeLabel = bikeName ? ` on ${bikeName}` : '';
  const baseBody = `${durationMin} min, ${distance} ${unit}${bikeLabel}`;
  const body = needsBikeAssignment
    ? `${baseBody} · Tap to choose which bike you rode`
    : baseBody;

  const ticketId = await sendPushNotification({
    pushToken: user.expoPushToken,
    title: 'Ride Synced',
    body,
    data: needsBikeAssignment
      ? { screen: 'ride', rideId, action: 'pickBike' }
      : { screen: 'ride', rideId },
  });

  return ticketId ?? undefined;
}

type ComponentPrediction = {
  componentId: string;
  componentType: string;
  brand: string;
  model: string;
  status: string;
  hoursRemaining: number;
  ridesRemainingEstimate: number;
};

/**
 * Check and send service due notifications for a bike after a ride is recorded.
 */
export async function checkAndNotifyServiceDue(params: {
  userId: string;
  bikeId: string;
  bikeName: string;
  pushToken: string;
  predictions: ComponentPrediction[];
}): Promise<string | undefined> {
  const { userId, bikeId, bikeName, pushToken, predictions } = params;

  const notifPref = await prisma.bikeNotificationPreference.findUnique({
    where: { bikeId },
  });

  // If no preference exists or notifications disabled, skip
  if (!notifPref || !notifPref.serviceNotificationsEnabled) return;

  const mode: ServiceNotificationMode = notifPref.serviceNotificationMode;
  const threshold = notifPref.serviceNotificationThreshold;

  // Find components that meet the notification criteria
  const componentsToNotify: ComponentPrediction[] = [];

  for (const pred of predictions) {
    let shouldNotify = false;

    switch (mode) {
      case 'RIDES_BEFORE':
        shouldNotify = pred.status !== 'ALL_GOOD' && pred.ridesRemainingEstimate <= threshold;
        break;
      case 'HOURS_BEFORE':
        shouldNotify = pred.status !== 'ALL_GOOD' && pred.hoursRemaining <= threshold;
        break;
      case 'AT_SERVICE':
        shouldNotify = pred.status === 'DUE_NOW' || pred.status === 'OVERDUE';
        break;
    }

    if (shouldNotify) {
      componentsToNotify.push(pred);
    }
  }

  if (componentsToNotify.length === 0) return;

  // Claim dedup slots before sending the notification. The unique constraint on
  // (userId, componentId, notificationType) ensures that concurrent callers cannot
  // both claim the same component — only the first insert wins.
  const newComponents: ComponentPrediction[] = [];
  for (const c of componentsToNotify) {
    try {
      await prisma.notificationLog.create({
        data: {
          userId,
          bikeId,
          componentId: c.componentId,
          notificationType: 'SERVICE_DUE',
        },
      });
      newComponents.push(c);
    } catch (err: unknown) {
      // Only swallow Prisma unique constraint violations (P2002) — rethrow anything else
      const isPrismaUniqueViolation =
        err instanceof Error &&
        'code' in err &&
        (err as { code: string }).code === 'P2002';
      if (!isPrismaUniqueViolation) throw err;
    }
  }

  if (newComponents.length === 0) return;

  const formatRemaining = (c: ComponentPrediction): string => {
    switch (mode) {
      case 'RIDES_BEFORE':
        return `${c.ridesRemainingEstimate} rides left`;
      case 'HOURS_BEFORE':
        // hoursRemaining goes negative once a component is past due, and
        // "-42h left" is not a sentence. The magnitude belongs in the app,
        // where the row can say "42h overdue"; a push notification only has to
        // say the part needs attention. The trigger above is unaffected: it
        // already fired at zero, so this only renames what was reaching it.
        return c.hoursRemaining <= 0 ? 'overdue' : `${Math.round(c.hoursRemaining)}h left`;
      case 'AT_SERVICE':
        return c.status === 'OVERDUE' ? 'overdue' : 'due now';
    }
  };

  const formatComponent = (c: ComponentPrediction) =>
    `${formatComponentType(c.componentType, null, { case: 'lower' })} (${formatRemaining(c)})`;

  let body: string;
  if (newComponents.length === 1) {
    body = `${formatComponentType(newComponents[0].componentType, null, { case: 'lower' })} needs service (${formatRemaining(newComponents[0])})`;
  } else {
    const MAX_LISTED = 2;
    const listed = newComponents.slice(0, MAX_LISTED).map(formatComponent).join(', ');
    const remaining = newComponents.length - MAX_LISTED;
    body = remaining > 0
      ? `${newComponents.length} components need service: ${listed}, and ${remaining} more`
      : `${newComponents.length} components need service: ${listed}`;
  }

  // For single-component notifications, surface the componentId so the
  // mobile bike detail screen can scroll the offending component into view
  // and auto-open its action sheet instead of dumping the user on the
  // bike page to scan for the alert. Multi-component notifications omit
  // it — there's no single component to focus, and the bike screen
  // already highlights "needs attention" components at the top.
  const data: Record<string, string> =
    newComponents.length === 1
      ? { screen: 'bike', bikeId, componentId: newComponents[0].componentId }
      : { screen: 'bike', bikeId };

  const ticketId = await sendPushNotification({
    pushToken,
    title: `${bikeName} - Service Due`,
    body,
    data,
  });

  if (!ticketId) {
    // Push failed — roll back dedup entries so the next ride sync can retry.
    // Without this, a transient push failure would permanently suppress
    // notifications for these components until the user services them.
    await prisma.notificationLog.deleteMany({
      where: {
        userId,
        componentId: { in: newComponents.map(c => c.componentId) },
        notificationType: 'SERVICE_DUE',
      },
    });
    return;
  }

  return ticketId;
}

/** The user fields every notification decision needs. */
const NOTIFICATION_USER_SELECT = {
  expoPushToken: true,
  rideSyncNotificationMode: true,
  distanceUnit: true,
  role: true,
  predictionMode: true,
  subscriptionTier: true,
  isFoundingRider: true,
} as const;

type LoadedNotificationUser = {
  expoPushToken: string | null;
  rideSyncNotificationMode: RideSyncNotificationMode;
  distanceUnit: string | null;
  role: UserRole;
  predictionMode: string | null;
  subscriptionTier: SubscriptionTier;
  isFoundingRider: boolean;
};

/**
 * Tier-gate, predict, and send the service-due push for one bike.
 * Shared by the ride-sync orchestrator and the mutation-facing
 * `fireServiceDueForBike`. Returns the push ticket id when one was sent.
 *
 * Service-due pushes carry the rides/hours-remaining prediction (a Pro
 * feature), so free users are gated out here, not at the callers.
 */
async function runServiceDueForBike(
  user: LoadedNotificationUser,
  userId: string,
  bikeId: string,
  bikeName: string
): Promise<string | undefined> {
  if (!user.expoPushToken || !canSeePredictions(user)) return;

  const predictionMode = (user.predictionMode === 'predictive' ? 'predictive' : 'simple') as 'simple' | 'predictive';
  const summary = await generateBikePredictions({
    userId,
    bikeId,
    userRole: user.role,
    predictionMode,
    subscriptionTier: user.subscriptionTier,
    isFoundingRider: user.isFoundingRider,
  });
  if (!summary?.components) return;

  return checkAndNotifyServiceDue({
    userId,
    bikeId,
    bikeName,
    pushToken: user.expoPushToken,
    predictions: summary.components,
  });
}

async function loadBikeName(userId: string, bikeId: string): Promise<string | undefined> {
  // Scoped to the owner so a caller bug can never push one user's bike name
  // to another user's device.
  const bike = await prisma.bike.findFirst({
    where: { id: bikeId, userId },
    select: { nickname: true, manufacturer: true, model: true },
  });
  if (!bike) return undefined;
  return bike.nickname || [bike.manufacturer, bike.model].filter(Boolean).join(' ') || undefined;
}

/**
 * Fire-and-forget service-due check for a bike whose counted hours just
 * changed OUTSIDE the ride-sync path: bulk bike assignment, a ride edit
 * that moved hours onto a bike, a manual ride entry.
 *
 * Before this existed, service-due could only fire as a side effect of an
 * integration sync: a rider who bulk-assigned fifteen backfilled rides
 * could push a bike straight past its service threshold in silence, and
 * heard nothing until their NEXT synced ride happened to land on that bike.
 * The dedup in `checkAndNotifyServiceDue` makes this safe to call from any
 * hour-crediting path: a component already notified stays silent.
 *
 * Never throws.
 */
export async function fireServiceDueForBike(params: {
  userId: string;
  bikeId: string;
}): Promise<void> {
  const { userId, bikeId } = params;
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: NOTIFICATION_USER_SELECT,
    });
    if (!user?.expoPushToken) return;

    const bikeName = await loadBikeName(userId, bikeId);
    if (!bikeName) return;

    const ticketId = await runServiceDueForBike(user, userId, bikeId, bikeName);
    if (ticketId) {
      enqueueReceiptCheck(userId, [ticketId], user.expoPushToken).catch((err) =>
        logError('enqueueReceiptCheck', err)
      );
    }
  } catch (error) {
    logError('fireServiceDueForBike', error);
  }
}

/**
 * Fire-and-forget: send ride upload notification and check service due notifications.
 * Errors are logged but never thrown to avoid blocking the caller.
 *
 * Whether the "Ride Synced" push goes out is decided by
 * `rideSyncNotificationMode`:
 *   ALL           every new integration ride, minus burst suppression
 *   ACTION_NEEDED only rides needing a bike pick, plus the account's
 *                 first-ever synced ride (the "it works" moment when a
 *                 provider is first connected)
 *   OFF           never
 * All ride pushes share one burst window (`RIDE_PUSH_WINDOW_MS`); the
 * service-due push is governed by per-bike preferences, not by this mode.
 */
export async function fireRideNotifications(params: {
  userId: string;
  rideId: string;
  bikeId: string | null;
  durationSeconds: number;
  distanceMeters: number;
  isNewRide: boolean;
  /** When set, this ride came from a bulk backfill — suppress per-ride notifications */
  isBackfill?: boolean;
  /** Pre-fetched active bike count — avoids redundant DB query when caller already has it */
  activeBikeCount?: number;
}): Promise<void> {
  const { userId, rideId, bikeId, durationSeconds, distanceMeters, isNewRide, isBackfill, activeBikeCount: providedBikeCount } = params;

  // Single structured log per call so missed-notification reports are
  // traceable end-to-end. Cardinality is ~one per ride sync — safe.
  logger.info(
    { userId, rideId, bikeId, isNewRide, isBackfill, providedBikeCount },
    '[notifications] fireRideNotifications invoked'
  );

  // Only notify for newly created rides, not updates or bulk backfills
  if (!isNewRide || isBackfill) return;

  try {
    // Single user query for all notification needs
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: NOTIFICATION_USER_SELECT,
    });

    if (!user?.expoPushToken) return;

    const bikeName = bikeId ? await loadBikeName(userId, bikeId) : undefined;

    const ticketIds: string[] = [];

    // Decide up-front whether the ride needs a bike-pick prompt so the upload
    // notification can be folded in. Previously this fired as a SECOND push
    // on multi-bike accounts (one "Ride Synced" + one "Assign a Bike"); with
    // multiple sync sources (Garmin/Strava/Whoop/Suunto) producing their own
    // pair each, the lockscreen got noisy. One consolidated push now carries
    // both the upload summary and the `action: 'pickBike'` deep-link hint.
    const needsBikeAssignment =
      !bikeId &&
      (providedBikeCount ?? (await prisma.bike.count({ where: { userId, status: 'ACTIVE' } }))) > 1;

    const mode = user.rideSyncNotificationMode;
    let sendRidePush = false;
    if (mode !== 'OFF') {
      if (needsBikeAssignment || mode === 'ALL') {
        sendRidePush = true;
      } else {
        // ACTION_NEEDED: the one non-actionable push that still earns its
        // place is the account's first-ever synced ride, the moment that
        // proves the integration works. count === 1 is the ride we are
        // holding right now.
        const rideCount = await prisma.ride.count({ where: { userId } });
        sendRidePush = rideCount === 1;
      }
      // One window for every ride push, whatever justified it. A burst of
      // unassigned rides means one pick-bike push, not one per ride; the
      // in-app unassigned-rides banner carries the rest.
      if (sendRidePush && (await isRidePushBurstSuppressed(userId))) {
        sendRidePush = false;
      }
    }

    if (sendRidePush) {
      const rideTicketId = await notifyRideUploaded({
        userId, rideId, durationSeconds, distanceMeters, bikeName,
        needsBikeAssignment,
        user: {
          expoPushToken: user.expoPushToken,
          distanceUnit: user.distanceUnit,
        },
      });
      if (rideTicketId) {
        ticketIds.push(rideTicketId);
        await recordRidePush(userId);
      }
    }

    // Service due check (only if ride is assigned to a bike). Deliberately
    // independent of rideSyncNotificationMode: silencing sync confirmations
    // must not silence "your fork is due", which has its own per-bike
    // preference and per-component dedup.
    if (bikeId && bikeName) {
      const serviceTicketId = await runServiceDueForBike(user, userId, bikeId, bikeName);
      if (serviceTicketId) ticketIds.push(serviceTicketId);
    }

    // Enqueue delayed receipt check for all tickets from this ride. The
    // token rides along so a DeviceNotRegistered receipt can be matched
    // against it rather than blindly clearing whatever is stored 15 minutes
    // from now.
    if (ticketIds.length > 0) {
      enqueueReceiptCheck(userId, ticketIds, user.expoPushToken).catch((err) =>
        logError('enqueueReceiptCheck', err)
      );
    }
  } catch (error) {
    logError('fireRideNotifications', error);
  }
}

/**
 * Clear notification logs for a component when it's serviced, so it can be re-notified.
 */
export async function clearServiceNotificationLogs(componentId: string, userId: string): Promise<void> {
  await prisma.notificationLog.deleteMany({
    where: {
      componentId,
      userId,
      notificationType: 'SERVICE_DUE',
    },
  });
}
