import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import { expo } from '../lib/expo';
import { prisma } from '../lib/prisma';
import { logError, logger } from '../lib/logger';
import { enqueueReceiptCheck } from '../lib/queue/notification.queue';
import { generateBikePredictions } from './prediction';
import type { ServiceNotificationMode } from '@prisma/client';

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
 */
async function sendPushNotification({ pushToken, title, body, data }: SendPushParams): Promise<string | null> {
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
  notifyOnRideUpload: boolean;
  distanceUnit: string | null;
};

/**
 * Send a notification when a ride is synced from an integration (Strava/Garmin).
 */
export async function notifyRideUploaded(params: {
  userId: string;
  rideId: string;
  durationSeconds: number;
  distanceMeters: number;
  bikeName?: string;
  user: NotificationUser;
}): Promise<string | undefined> {
  const { userId, rideId, durationSeconds, distanceMeters, bikeName, user } = params;

  if (!user.notifyOnRideUpload) return;

  const durationMin = Math.round(durationSeconds / 60);
  const isKm = user.distanceUnit === 'km';
  const distance = isKm
    ? (distanceMeters / 1000).toFixed(1)
    : (distanceMeters / 1609.344).toFixed(1);
  const unit = isKm ? 'km' : 'mi';

  const bikeLabel = bikeName ? ` on ${bikeName}` : '';
  const body = `${durationMin} min, ${distance} ${unit}${bikeLabel}`;

  const ticketId = await sendPushNotification({
    pushToken: user.expoPushToken,
    title: 'Ride Synced',
    body,
    data: { screen: 'ride', rideId },
  });

  if (ticketId) {
    // Audit log only — not used for deduplication. componentId is null here,
    // so the unique constraint on (userId, componentId, notificationType) does
    // not apply (NULL != NULL in PostgreSQL). Ride upload dedup is unnecessary
    // because each synced ride only triggers one notification via fireRideNotifications.
    await prisma.notificationLog.create({
      data: {
        userId,
        notificationType: 'RIDE_UPLOADED',
      },
    });
    return ticketId;
  }
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

  // Send one notification per bike summarizing components due
  const componentNames = newComponents
    .map(c => `${c.componentType.replace(/_/g, ' ').toLowerCase()}`)
    .join(', ');

  const formatRemaining = (c: ComponentPrediction): string => {
    switch (mode) {
      case 'RIDES_BEFORE':
        return `${c.ridesRemainingEstimate} rides left`;
      case 'HOURS_BEFORE':
        return `${Math.round(c.hoursRemaining)}h left`;
      case 'AT_SERVICE':
        return c.status === 'OVERDUE' ? 'overdue' : 'due now';
    }
  };

  const body = newComponents.length === 1
    ? `${newComponents[0].componentType.replace(/_/g, ' ').toLowerCase()} needs service (${formatRemaining(newComponents[0])})`
    : `${newComponents.length} components need service: ${componentNames}`;

  const ticketId = await sendPushNotification({
    pushToken,
    title: `${bikeName} - Service Due`,
    body,
    data: { screen: 'bike', bikeId },
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

/**
 * Fire-and-forget: send ride upload notification and check service due notifications.
 * Errors are logged but never thrown to avoid blocking the caller.
 */
export async function fireRideNotifications(params: {
  userId: string;
  rideId: string;
  bikeId: string | null;
  durationSeconds: number;
  distanceMeters: number;
  isNewRide: boolean;
}): Promise<void> {
  const { userId, rideId, bikeId, durationSeconds, distanceMeters, isNewRide } = params;

  // Only notify for newly created rides, not updates
  if (!isNewRide) return;

  try {
    // Single user query for all notification needs
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        expoPushToken: true,
        notifyOnRideUpload: true,
        distanceUnit: true,
        role: true,
        predictionMode: true,
      },
    });

    if (!user?.expoPushToken) return;

    // Get bike name if assigned
    let bikeName: string | undefined;
    if (bikeId) {
      const bike = await prisma.bike.findUnique({
        where: { id: bikeId },
        select: { nickname: true, manufacturer: true, model: true },
      });
      if (bike) {
        bikeName = bike.nickname || [bike.manufacturer, bike.model].filter(Boolean).join(' ') || undefined;
      }
    }

    const ticketIds: string[] = [];

    // Ride upload notification
    const rideTicketId = await notifyRideUploaded({
      userId, rideId, durationSeconds, distanceMeters, bikeName,
      user: {
        expoPushToken: user.expoPushToken,
        notifyOnRideUpload: user.notifyOnRideUpload,
        distanceUnit: user.distanceUnit,
      },
    });
    if (rideTicketId) ticketIds.push(rideTicketId);

    // Service due check (only if ride is assigned to a bike)
    if (bikeId && bikeName) {
      const predictionMode = (user.predictionMode === 'predictive' ? 'predictive' : 'simple') as 'simple' | 'predictive';
      const summary = await generateBikePredictions({
        userId,
        bikeId,
        userRole: user.role,
        predictionMode,
      });
      if (summary?.components) {
        const serviceTicketId = await checkAndNotifyServiceDue({
          userId,
          bikeId,
          bikeName,
          pushToken: user.expoPushToken,
          predictions: summary.components,
        });
        if (serviceTicketId) ticketIds.push(serviceTicketId);
      }
    }

    // Enqueue delayed receipt check for all tickets from this ride
    if (ticketIds.length > 0) {
      enqueueReceiptCheck(userId, ticketIds).catch((err) =>
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
export async function clearServiceNotificationLogs(componentId: string): Promise<void> {
  await prisma.notificationLog.deleteMany({
    where: {
      componentId,
      notificationType: 'SERVICE_DUE',
    },
  });
}
