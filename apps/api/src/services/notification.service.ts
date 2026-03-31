import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import { prisma } from '../lib/prisma';
import { logError } from '../lib/logger';
import type { ServiceNotificationMode } from '@prisma/client';

const expo = new Expo();

type SendPushParams = {
  pushToken: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

async function sendPushNotification({ pushToken, title, body, data }: SendPushParams): Promise<boolean> {
  if (!Expo.isExpoPushToken(pushToken)) {
    console.warn(`[notifications] Invalid Expo push token: ${pushToken}`);
    return false;
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
      console.error(`[notifications] Push error: ${ticket.message}`, ticket.details);
      return false;
    }
    return true;
  } catch (error) {
    logError('sendPushNotification', error);
    return false;
  }
}

/**
 * Send a notification when a ride is synced from an integration (Strava/Garmin).
 */
export async function notifyRideUploaded(params: {
  userId: string;
  rideId: string;
  durationSeconds: number;
  distanceMeters: number;
  bikeName?: string;
}): Promise<void> {
  const { userId, rideId, durationSeconds, distanceMeters, bikeName } = params;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { expoPushToken: true, notifyOnRideUpload: true, distanceUnit: true },
  });

  if (!user?.expoPushToken || !user.notifyOnRideUpload) return;

  const durationMin = Math.round(durationSeconds / 60);
  const isKm = user.distanceUnit === 'km';
  const distance = isKm
    ? (distanceMeters / 1000).toFixed(1)
    : (distanceMeters / 1609.344).toFixed(1);
  const unit = isKm ? 'km' : 'mi';

  const bikeLabel = bikeName ? ` on ${bikeName}` : '';
  const body = `${durationMin} min, ${distance} ${unit}${bikeLabel}`;

  const sent = await sendPushNotification({
    pushToken: user.expoPushToken,
    title: 'Ride Synced',
    body,
    data: { screen: 'ride', rideId },
  });

  if (sent) {
    await prisma.notificationLog.create({
      data: {
        userId,
        notificationType: 'RIDE_UPLOADED',
      },
    });
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
  predictions: ComponentPrediction[];
}): Promise<void> {
  const { userId, bikeId, bikeName, predictions } = params;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { expoPushToken: true },
  });

  if (!user?.expoPushToken) return;

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
        shouldNotify = pred.ridesRemainingEstimate <= threshold;
        break;
      case 'HOURS_BEFORE':
        shouldNotify = pred.hoursRemaining <= threshold;
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

  // Check dedup: skip components already notified since last service
  const existingLogs = await prisma.notificationLog.findMany({
    where: {
      userId,
      componentId: { in: componentsToNotify.map(c => c.componentId) },
      notificationType: 'SERVICE_DUE',
    },
    select: { componentId: true },
  });

  const alreadyNotified = new Set(existingLogs.map(l => l.componentId));
  const newComponents = componentsToNotify.filter(c => !alreadyNotified.has(c.componentId));

  if (newComponents.length === 0) return;

  // Send one notification per bike summarizing components due
  const componentNames = newComponents
    .map(c => `${c.componentType.replace(/_/g, ' ').toLowerCase()}`)
    .join(', ');

  const body = newComponents.length === 1
    ? `${newComponents[0].componentType.replace(/_/g, ' ').toLowerCase()} needs service (${newComponents[0].ridesRemainingEstimate} rides left)`
    : `${newComponents.length} components need service: ${componentNames}`;

  const sent = await sendPushNotification({
    pushToken: user.expoPushToken,
    title: `${bikeName} - Service Due`,
    body,
    data: { screen: 'bike', bikeId },
  });

  if (sent) {
    // Log all notified components for dedup
    await prisma.notificationLog.createMany({
      data: newComponents.map(c => ({
        userId,
        bikeId,
        componentId: c.componentId,
        notificationType: 'SERVICE_DUE' as const,
      })),
    });
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
