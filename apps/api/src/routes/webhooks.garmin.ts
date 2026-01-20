import { Router as createRouter, type Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma';
import { getValidGarminToken } from '../lib/garmin-token';
import { deriveLocationAsync, shouldApplyAutoLocation } from '../lib/location';
import { logger, logError } from '../lib/logger';

type Empty = Record<string, never>;
const r: Router = createRouter();

/**
 * Deregistration webhook
 * Called by Garmin when a user disconnects from Garmin Connect or we call DELETE /registration
 * Spec: Garmin Developer Guide Section 2.6.2
 */
r.post<Empty, void, { deregistrations?: Array<{ userId: string }> }>(
  '/webhooks/garmin/deregistration',
  async (req: Request, res: Response) => {
    try {
      const { deregistrations } = req.body;

      if (!deregistrations || !Array.isArray(deregistrations)) {
        logger.warn({ body: req.body }, '[Garmin Deregistration] Invalid payload');
        return res.status(400).json({ error: 'Invalid deregistration payload' });
      }

      logger.info({ count: deregistrations.length }, '[Garmin Deregistration] Received deregistration(s)');

      for (const { userId: garminUserId } of deregistrations) {
        // Find the user by their Garmin User ID
        const userAccount = await prisma.userAccount.findUnique({
          where: {
            provider_providerUserId: {
              provider: 'garmin',
              providerUserId: garminUserId,
            },
          },
        });

        if (!userAccount) {
          logger.warn({ garminUserId }, '[Garmin Deregistration] Unknown Garmin userId');
          continue;
        }

        // Delete OAuth tokens and UserAccount record
        await prisma.$transaction([
          prisma.oauthToken.deleteMany({
            where: {
              userId: userAccount.userId,
              provider: 'garmin',
            },
          }),
          prisma.userAccount.delete({
            where: {
              provider_providerUserId: {
                provider: 'garmin',
                providerUserId: garminUserId,
              },
            },
          }),
        ]);

        logger.info({ userId: userAccount.userId }, '[Garmin Deregistration] Removed Garmin connection');
      }

      // Return 200 OK immediately (Garmin requires this)
      return res.status(200).send('OK');
    } catch (error) {
      logError('Garmin Deregistration', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * User Permissions webhook
 * Called when a user changes their data sharing permissions
 * Spec: Garmin Developer Guide Section 2.6.3
 */
r.post<Empty, void, { userPermissionsChange?: Array<{
  userId: string;
  summaryId: string;
  permissions: string[];
  changeTimeInSeconds: number;
}> }>(
  '/webhooks/garmin/permissions',
  async (req: Request, res: Response) => {
    try {
      const { userPermissionsChange } = req.body;

      if (!userPermissionsChange || !Array.isArray(userPermissionsChange)) {
        logger.warn({ body: req.body }, '[Garmin Permissions] Invalid payload');
        return res.status(400).json({ error: 'Invalid permissions payload' });
      }

      logger.info({ count: userPermissionsChange.length }, '[Garmin Permissions] Received permission change(s)');

      for (const change of userPermissionsChange) {
        const { userId: garminUserId, permissions } = change;

        // Find the user by their Garmin User ID
        const userAccount = await prisma.userAccount.findUnique({
          where: {
            provider_providerUserId: {
              provider: 'garmin',
              providerUserId: garminUserId,
            },
          },
        });

        if (!userAccount) {
          logger.warn({ garminUserId }, '[Garmin Permissions] Unknown Garmin userId');
          continue;
        }

        logger.info({ userId: userAccount.userId, permissions }, '[Garmin Permissions] User permissions');

        // Check if ACTIVITY_EXPORT permission is still granted
        if (!permissions.includes('ACTIVITY_EXPORT')) {
          logger.warn({ userId: userAccount.userId }, '[Garmin Permissions] User revoked ACTIVITY_EXPORT permission');
          // You could notify the user or disable sync here
        }
      }

      // Return 200 OK immediately (Garmin requires this)
      return res.status(200).send('OK');
    } catch (error) {
      logError('Garmin Permissions', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * Activity PING webhook (Recommended)
 * Receives notification from Garmin with userId and summaryId (PING mode)
 * We then fetch the full activity details using the Activity API
 * Spec: Garmin Activity API Section 5 (Ping Service)
 *
 * PING mode is preferred because it includes userId in the notification.
 *
 * Garmin sends TWO different payload formats:
 * 1. activityDetails: [{ userId, summaryId, userAccessToken, ... }]
 * 2. activities: [{ userId, callbackURL }] - used for backfill responses
 */
type GarminActivityPing = {
  userId: string;
  userAccessToken: string;
  summaryId: string;
  uploadTimestampInSeconds: number;
  [key: string]: unknown;
};

type GarminActivityCallback = {
  userId: string;
  callbackURL: string;
  [key: string]: unknown;
};

type GarminPingPayload = {
  activityDetails?: GarminActivityPing[];
  activities?: GarminActivityCallback[];
};

type GarminActivityDetail = {
  summaryId: string;
  activityId?: number;
  activityType: string;
  activityName?: string;
  startTimeInSeconds: number;
  startTimeOffsetInSeconds?: number;
  durationInSeconds: number;
  distanceInMeters?: number;
  elevationGainInMeters?: number;
  totalElevationGainInMeters?: number;
  averageHeartRateInBeatsPerMinute?: number;
  maxHeartRateInBeatsPerMinute?: number;
  averageSpeedInMetersPerSecond?: number;
  maxSpeedInMetersPerSecond?: number;
  activeKilocalories?: number;
  deviceName?: string;
  manual?: boolean;
  locationName?: string;
  startLatitudeInDegrees?: number;
  startLongitudeInDegrees?: number;
  beginLatitude?: number;
  beginLongitude?: number;
  [key: string]: unknown;
};

r.post<Empty, void, GarminPingPayload>(
  '/webhooks/garmin/activities-ping',
  async (req: Request, res: Response) => {
    // Log incoming webhook request IMMEDIATELY to verify Garmin is hitting this endpoint
    logger.debug({ headers: req.headers, body: req.body }, '[Garmin PING Webhook] Incoming request');

    try {
      const { activityDetails, activities } = req.body;

      // Handle the "activities" format with callbackURL (used for backfill)
      if (activities && Array.isArray(activities) && activities.length > 0) {
        logger.info({ count: activities.length }, '[Garmin Activities PING] Received callback notification(s)');

        // IMPORTANT: Respond with 200 OK immediately (Garmin requires this within 30 seconds)
        res.status(200).send('OK');

        // Process each callback URL
        for (const notification of activities) {
          try {
            await processActivityCallback(notification);
          } catch (error) {
            logError(`Garmin Activities PING callback user ${notification.userId}`, error);
            // Continue processing other notifications even if one fails
          }
        }
        return;
      }

      // Handle the "activityDetails" format with summaryId
      if (activityDetails && Array.isArray(activityDetails) && activityDetails.length > 0) {
        logger.info({ count: activityDetails.length }, '[Garmin Activities PING] Received notification(s)');

        // IMPORTANT: Respond with 200 OK immediately (Garmin requires this within 30 seconds)
        res.status(200).send('OK');

        // Process activity notifications after responding
        for (const notification of activityDetails) {
          try {
            await processActivityPing(notification);
          } catch (error) {
            logError(`Garmin Activities PING notification ${notification.summaryId}`, error);
            // Continue processing other notifications even if one fails
          }
        }
        return;
      }

      // Neither format matched
      logger.warn({ body: req.body }, '[Garmin Activities PING] Invalid payload');
      return res.status(400).json({ error: 'Invalid activities payload' });
    } catch (error) {
      logError('Garmin Activities PING', error);
      // Already responded, so just log the error
    }
  }
);

/**
 * Process a single Garmin activity notification from PING mode
 * Fetches full activity details from Garmin API using the provided summaryId
 */
async function processActivityPing(notification: GarminActivityPing): Promise<void> {
  const { userId: garminUserId, summaryId } = notification;

  logger.info({ summaryId }, '[Garmin Activities PING] Processing notification');

  // Find the user by their Garmin User ID
  const userAccount = await prisma.userAccount.findUnique({
    where: {
      provider_providerUserId: {
        provider: 'garmin',
        providerUserId: garminUserId,
      },
    },
  });

  if (!userAccount) {
    logger.warn({ garminUserId }, '[Garmin Activities PING] Unknown Garmin userId');
    return;
  }

  logger.info({ userId: userAccount.userId }, '[Garmin Activities PING] Found user');

  // Fetch the full activity details from Garmin API
  // The summaryId is the activityId we need to fetch
  const API_BASE = process.env.GARMIN_API_BASE || 'https://apis.garmin.com/wellness-api';

  // Get valid access token (auto-refreshes if expired)
  const accessToken = await getValidGarminToken(userAccount.userId);

  if (!accessToken) {
    logger.error({ userId: userAccount.userId }, '[Garmin Activities PING] No valid OAuth token');
    return;
  }

  // Fetch activity details from Garmin Activity API
  // Endpoint: GET /wellness-api/rest/activityFile/{summaryId}
  const activityUrl = `${API_BASE}/rest/activityFile/${summaryId}`;

  try {
    const activityRes = await fetch(activityUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!activityRes.ok) {
      const text = await activityRes.text();
      logger.error({ summaryId, status: activityRes.status, response: text }, '[Garmin Activities PING] Failed to fetch activity');
      return;
    }

    const activityDetail = (await activityRes.json()) as GarminActivityDetail;

    // Filter: Only process cycling/mountain biking activities
    const CYCLING_ACTIVITY_TYPES = [
      'cycling',
      'bmx',
      'cyclocross',
      'downhill_biking',
      'e_bike_fitness',
      'e_bike_mountain',
      'e_enduro_mtb',
      'enduro_mtb',
      'gravel_cycling',
      'indoor_cycling',
      'mountain_biking',
      'recumbent_cycling',
      'road_biking',
      'track_cycling',
      'virtual_ride',
      'handcycling',
      'indoor_handcycling',
    ];

    const activityTypeLower = activityDetail.activityType.toLowerCase().replace(/\s+/g, '_');
    if (!CYCLING_ACTIVITY_TYPES.includes(activityTypeLower)) {
      logger.debug({ activityType: activityDetail.activityType, summaryId }, '[Garmin Activities PING] Skipping non-cycling activity');
      return;
    }

    logger.info({ activityType: activityDetail.activityType }, '[Garmin Activities PING] Processing cycling activity');

    // Convert activity to Ride format
    const distanceMiles = activityDetail.distanceInMeters
      ? activityDetail.distanceInMeters * 0.000621371
      : 0;

    const elevationGainFeet = (activityDetail.totalElevationGainInMeters ?? activityDetail.elevationGainInMeters)
      ? (activityDetail.totalElevationGainInMeters ?? activityDetail.elevationGainInMeters)! * 3.28084
      : 0;

    const startTime = new Date(activityDetail.startTimeInSeconds * 1000);

    const autoLocation = await deriveLocationAsync({
      city: activityDetail.locationName ?? null,
      state: null,
      country: null,
      lat:
        activityDetail.startLatitudeInDegrees ??
        activityDetail.beginLatitude ??
        null,
      lon:
        activityDetail.startLongitudeInDegrees ??
        activityDetail.beginLongitude ??
        null,
    });

    const existingRide = await prisma.ride.findUnique({
      where: { garminActivityId: summaryId },
      select: { location: true },
    });

    const locationUpdate = shouldApplyAutoLocation(
      existingRide?.location ?? null,
      autoLocation?.title ?? null
    );

    // Look up running ImportSession for this user (if any)
    const runningSession = await prisma.importSession.findFirst({
      where: { userId: userAccount.userId, provider: 'garmin', status: 'running' },
      select: { id: true },
    });

    // Upsert the ride (create or update if it already exists)
    await prisma.ride.upsert({
      where: {
        garminActivityId: summaryId,
      },
      create: {
        userId: userAccount.userId,
        garminActivityId: summaryId,
        startTime,
        durationSeconds: activityDetail.durationInSeconds,
        distanceMiles,
        elevationGainFeet,
        averageHr: activityDetail.averageHeartRateInBeatsPerMinute ?? null,
        rideType: activityDetail.activityType,
        notes: activityDetail.activityName ?? null,
        location: autoLocation?.title ?? null,
        importSessionId: runningSession?.id ?? null,
      },
      update: {
        startTime,
        durationSeconds: activityDetail.durationInSeconds,
        distanceMiles,
        elevationGainFeet,
        averageHr: activityDetail.averageHeartRateInBeatsPerMinute ?? null,
        rideType: activityDetail.activityType,
        notes: activityDetail.activityName ?? null,
        ...(locationUpdate !== undefined ? { location: locationUpdate } : {}),
        // Note: Do NOT update importSessionId - keep original session assignment
      },
    });

    // Update session's lastActivityReceivedAt if there's a running session
    if (runningSession) {
      await prisma.importSession.update({
        where: { id: runningSession.id },
        data: { lastActivityReceivedAt: new Date() },
      });
    }

    logger.info({ summaryId }, '[Garmin Activities PING] Successfully stored ride');
  } catch (error) {
    logError(`Garmin Activities PING ${summaryId}`, error);
    throw error;
  }
}

/**
 * Process a Garmin activity callback notification (used for backfill)
 * Fetches activities from the provided callbackURL
 */
async function processActivityCallback(notification: GarminActivityCallback): Promise<void> {
  const { userId: garminUserId, callbackURL } = notification;

  logger.info({ garminUserId, callbackURL }, '[Garmin Activities Callback] Processing callback');

  // Find the user by their Garmin User ID
  const userAccount = await prisma.userAccount.findUnique({
    where: {
      provider_providerUserId: {
        provider: 'garmin',
        providerUserId: garminUserId,
      },
    },
  });

  if (!userAccount) {
    logger.warn({ garminUserId }, '[Garmin Activities Callback] Unknown Garmin userId');
    return;
  }

  logger.info({ userId: userAccount.userId }, '[Garmin Activities Callback] Found user');

  // Get valid access token (auto-refreshes if expired)
  const accessToken = await getValidGarminToken(userAccount.userId);

  if (!accessToken) {
    logger.error({ userId: userAccount.userId }, '[Garmin Activities Callback] No valid OAuth token');
    return;
  }

  try {
    // Fetch activities from the callback URL
    const callbackRes = await fetch(callbackURL, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!callbackRes.ok) {
      const text = await callbackRes.text();
      logger.error({ status: callbackRes.status, response: text }, '[Garmin Activities Callback] Failed to fetch from callback URL');
      return;
    }

    const activities = (await callbackRes.json()) as GarminActivityDetail[];

    if (!Array.isArray(activities)) {
      logger.error({ response: activities }, '[Garmin Activities Callback] Unexpected response format');
      return;
    }

    logger.info({ count: activities.length }, '[Garmin Activities Callback] Fetched activities from callback URL');

    // Filter: Only process cycling/mountain biking activities
    const CYCLING_ACTIVITY_TYPES = [
      'cycling',
      'bmx',
      'cyclocross',
      'downhill_biking',
      'e_bike_fitness',
      'e_bike_mountain',
      'e_enduro_mtb',
      'enduro_mtb',
      'gravel_cycling',
      'indoor_cycling',
      'mountain_biking',
      'recumbent_cycling',
      'road_biking',
      'track_cycling',
      'virtual_ride',
      'handcycling',
      'indoor_handcycling',
    ];

    // Look up running ImportSession for this user once before processing the batch
    // This avoids N+1 queries when processing many activities
    const runningSession = await prisma.importSession.findFirst({
      where: { userId: userAccount.userId, provider: 'garmin', status: 'running' },
      select: { id: true },
    });

    let processedActivityCount = 0;

    for (const activity of activities) {
      const activityTypeLower = activity.activityType.toLowerCase().replace(/\s+/g, '_');
      if (!CYCLING_ACTIVITY_TYPES.includes(activityTypeLower)) {
        logger.debug({ activityType: activity.activityType, summaryId: activity.summaryId }, '[Garmin Activities Callback] Skipping non-cycling activity');
        continue;
      }

      logger.info({ activityType: activity.activityType, summaryId: activity.summaryId }, '[Garmin Activities Callback] Processing cycling activity');

      // Convert activity to Ride format
      const distanceMiles = activity.distanceInMeters
        ? activity.distanceInMeters * 0.000621371
        : 0;

      const elevationGainFeet = (activity.totalElevationGainInMeters ?? activity.elevationGainInMeters)
        ? (activity.totalElevationGainInMeters ?? activity.elevationGainInMeters)! * 3.28084
        : 0;

      const startTime = new Date(activity.startTimeInSeconds * 1000);

      const autoLocation = await deriveLocationAsync({
        city: activity.locationName ?? null,
        state: null,
        country: null,
        lat:
          activity.startLatitudeInDegrees ??
          activity.beginLatitude ??
          null,
        lon:
          activity.startLongitudeInDegrees ??
          activity.beginLongitude ??
          null,
      });

      const existingRide = await prisma.ride.findUnique({
        where: { garminActivityId: activity.summaryId },
        select: { location: true },
      });

      const locationUpdate = shouldApplyAutoLocation(
        existingRide?.location ?? null,
        autoLocation?.title ?? null
      );

      // Upsert the ride (create or update if it already exists)
      await prisma.ride.upsert({
        where: {
          garminActivityId: activity.summaryId,
        },
        create: {
          userId: userAccount.userId,
          garminActivityId: activity.summaryId,
          startTime,
          durationSeconds: activity.durationInSeconds,
          distanceMiles,
          elevationGainFeet,
          averageHr: activity.averageHeartRateInBeatsPerMinute ?? null,
          rideType: activity.activityType,
          notes: activity.activityName ?? null,
          location: autoLocation?.title ?? null,
          importSessionId: runningSession?.id ?? null,
        },
        update: {
          startTime,
          durationSeconds: activity.durationInSeconds,
          distanceMiles,
          elevationGainFeet,
          averageHr: activity.averageHeartRateInBeatsPerMinute ?? null,
          rideType: activity.activityType,
          notes: activity.activityName ?? null,
          ...(locationUpdate !== undefined ? { location: locationUpdate } : {}),
          // Note: Do NOT update importSessionId - keep original session assignment
        },
      });

      processedActivityCount++;
      logger.info({ summaryId: activity.summaryId }, '[Garmin Activities Callback] Successfully stored ride');
    }

    // Update session's lastActivityReceivedAt once after processing the batch
    // This avoids N updates when processing many activities
    if (runningSession && processedActivityCount > 0) {
      await prisma.importSession.update({
        where: { id: runningSession.id },
        data: { lastActivityReceivedAt: new Date() },
      });
    }
  } catch (error) {
    // Log the error but don't re-throw - allow other notifications in the batch to continue
    // Network failures, JSON parse errors, or DB errors for one callback shouldn't crash the entire batch
    logError('Garmin Activities Callback', error);
  }
}

export default r;
