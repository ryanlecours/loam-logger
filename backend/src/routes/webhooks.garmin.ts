import { Router as createRouter, type Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma.ts';

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
        console.warn('[Garmin Deregistration] Invalid payload:', req.body);
        return res.status(400).json({ error: 'Invalid deregistration payload' });
      }

      console.log(`[Garmin Deregistration] Received ${deregistrations.length} deregistration(s)`);

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
          console.warn(`[Garmin Deregistration] Unknown Garmin userId: ${garminUserId}`);
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

        console.log(`[Garmin Deregistration] Removed Garmin connection for userId: ${userAccount.userId}`);
      }

      // Return 200 OK immediately (Garmin requires this)
      return res.status(200).send('OK');
    } catch (error) {
      console.error('[Garmin Deregistration] Error:', error);
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
        console.warn('[Garmin Permissions] Invalid payload:', req.body);
        return res.status(400).json({ error: 'Invalid permissions payload' });
      }

      console.log(`[Garmin Permissions] Received ${userPermissionsChange.length} permission change(s)`);

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
          console.warn(`[Garmin Permissions] Unknown Garmin userId: ${garminUserId}`);
          continue;
        }

        console.log(`[Garmin Permissions] User ${userAccount.userId} permissions:`, permissions);

        // Check if ACTIVITY_EXPORT permission is still granted
        if (!permissions.includes('ACTIVITY_EXPORT')) {
          console.warn(`[Garmin Permissions] User ${userAccount.userId} revoked ACTIVITY_EXPORT permission`);
          // You could notify the user or disable sync here
        }
      }

      // Return 200 OK immediately (Garmin requires this)
      return res.status(200).send('OK');
    } catch (error) {
      console.error('[Garmin Permissions] Error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * Activity PUSH webhook
 * Receives activity data directly from Garmin (PUSH mode)
 * Spec: Garmin Activity API Section 5 (Push Service)
 *
 * NOTE: PUSH mode has a limitation - it doesn't include userId in the payload.
 * Consider using PING mode instead (see /webhooks/garmin/activities-ping endpoint below).
 */
type GarminActivityPush = {
  summaryId: string;
  activityId: number;
  activityType: string;
  activityName?: string;
  startTimeInSeconds: number;
  startTimeOffsetInSeconds: number;
  durationInSeconds: number;
  distanceInMeters?: number;
  elevationGainInMeters?: number; // Note: Garmin uses totalElevationGainInMeters
  totalElevationGainInMeters?: number;
  averageHeartRateInBeatsPerMinute?: number;
  averageSpeedInMetersPerSecond?: number;
  activeKilocalories?: number;
  deviceName?: string;
  manual?: boolean;
  notes?: string;
  [key: string]: unknown; // Allow other fields
};

r.post<Empty, void, { activities?: GarminActivityPush[] }>(
  '/webhooks/garmin/activities',
  async (req: Request, res: Response) => {
    try {
      const { activities } = req.body;

      if (!activities || !Array.isArray(activities)) {
        console.warn('[Garmin Activities PUSH] Invalid payload:', req.body);
        return res.status(400).json({ error: 'Invalid activities payload' });
      }

      console.log(`[Garmin Activities PUSH] Received ${activities.length} activity(ies)`);

      // IMPORTANT: Respond with 200 OK immediately (Garmin requires this within 30 seconds)
      // Process activities asynchronously
      res.status(200).send('OK');

      // Process activities after responding
      for (const activity of activities) {
        try {
          await processActivityPush(activity);
        } catch (error) {
          console.error(`[Garmin Activities PUSH] Failed to process activity ${activity.summaryId}:`, error);
          // Continue processing other activities even if one fails
        }
      }
    } catch (error) {
      console.error('[Garmin Activities PUSH] Error:', error);
      // Already responded, so just log the error
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
 */
type GarminActivityPing = {
  userId: string;
  userAccessToken: string;
  summaryId: string;
  uploadTimestampInSeconds: number;
  [key: string]: unknown;
};

r.post<Empty, void, { activityDetails?: GarminActivityPing[] }>(
  '/webhooks/garmin/activities-ping',
  async (req: Request, res: Response) => {
    try {
      const { activityDetails } = req.body;

      if (!activityDetails || !Array.isArray(activityDetails)) {
        console.warn('[Garmin Activities PING] Invalid payload:', req.body);
        return res.status(400).json({ error: 'Invalid activities payload' });
      }

      console.log(`[Garmin Activities PING] Received ${activityDetails.length} notification(s)`);

      // IMPORTANT: Respond with 200 OK immediately (Garmin requires this within 30 seconds)
      res.status(200).send('OK');

      // Process activity notifications after responding
      for (const notification of activityDetails) {
        try {
          await processActivityPing(notification);
        } catch (error) {
          console.error(`[Garmin Activities PING] Failed to process notification ${notification.summaryId}:`, error);
          // Continue processing other notifications even if one fails
        }
      }
    } catch (error) {
      console.error('[Garmin Activities PING] Error:', error);
      // Already responded, so just log the error
    }
  }
);

/**
 * Process a single Garmin activity from PUSH mode
 * NOTE: This has limitations due to missing userId in the payload
 */
async function processActivityPush(activity: GarminActivityPush): Promise<void> {
  const {
    activityId,
    activityType,
    startTimeInSeconds,
    _durationInSeconds,
    distanceInMeters,
    totalElevationGainInMeters,
    _averageHeartRateInBeatsPerMinute,
  } = activity;

  console.log(`[Garmin Activities PUSH] Processing activity ${activityId} (${activityType})`);

  // Note: The activity doesn't include the userId directly
  // We need to identify the user another way, or Garmin needs to include it
  // According to the docs, PUSH notifications don't include userId
  // This is a limitation - we'll need to handle this differently

  // For now, log a warning
  console.warn('[Garmin Activities PUSH] PUSH notification does not include userId - cannot identify user');
  console.warn('[Garmin Activities PUSH] Consider using PING mode instead (/webhooks/garmin/activities-ping)');

  // TODO: Implement user identification strategy
  // Option 1: Use PING mode instead (includes userId) - RECOMMENDED
  // Option 2: Store a mapping of summaryId -> userId from backfill
  // Option 3: Use Activity Details endpoint to fetch userId

  // Convert activity to Ride format (these will be used when TODO is implemented)
  const _distanceMiles = distanceInMeters ? distanceInMeters * 0.000621371 : 0;
  const _elevationGainFeet = totalElevationGainInMeters ? totalElevationGainInMeters * 3.28084 : 0;
  const _startTime = new Date(startTimeInSeconds * 1000);

  // TODO: Once userId identification is resolved, uncomment and update:
  /*
  await prisma.ride.upsert({
    where: {
      garminActivityId: activityId.toString(),
    },
    create: {
      userId: resolvedUserId,
      garminActivityId: activityId.toString(),
      startTime,
      durationSeconds: durationInSeconds,
      distanceMiles,
      elevationGainFeet,
      averageHr: averageHeartRateInBeatsPerMinute ?? null,
      rideType: activityType,
      notes: activity.activityName ?? null,
    },
    update: {
      startTime,
      durationSeconds: durationInSeconds,
      distanceMiles,
      elevationGainFeet,
      averageHr: averageHeartRateInBeatsPerMinute ?? null,
      rideType: activityType,
      notes: activity.activityName ?? null,
    },
  });

  console.log(`[Garmin Activities PUSH] Successfully stored ride for activity ${activityId}`);
  */
}

/**
 * Process a single Garmin activity notification from PING mode
 * Fetches full activity details from Garmin API using the provided summaryId
 */
async function processActivityPing(notification: GarminActivityPing): Promise<void> {
  const { userId: garminUserId, summaryId } = notification;

  console.log(`[Garmin Activities PING] Processing notification for summaryId: ${summaryId}`);

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
    console.warn(`[Garmin Activities PING] Unknown Garmin userId: ${garminUserId}`);
    return;
  }

  console.log(`[Garmin Activities PING] Found user: ${userAccount.userId}`);

  // Fetch the full activity details from Garmin API
  // The summaryId is the activityId we need to fetch
  const API_BASE = process.env.GARMIN_API_BASE || 'https://apis.garmin.com/wellness-api';

  // Get user's access token
  const token = await prisma.oauthToken.findUnique({
    where: {
      userId_provider: {
        userId: userAccount.userId,
        provider: 'garmin',
      },
    },
  });

  if (!token) {
    console.error(`[Garmin Activities PING] No OAuth token found for user ${userAccount.userId}`);
    return;
  }

  // Fetch activity details from Garmin Activity API
  // Endpoint: GET /wellness-api/rest/activityFile/{summaryId}
  const activityUrl = `${API_BASE}/rest/activityFile/${summaryId}`;

  try {
    const activityRes = await fetch(activityUrl, {
      headers: {
        'Authorization': `Bearer ${token.accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!activityRes.ok) {
      const text = await activityRes.text();
      console.error(`[Garmin Activities PING] Failed to fetch activity ${summaryId}: ${activityRes.status} ${text}`);
      return;
    }

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
      [key: string]: unknown;
    };

    const activityDetail = (await activityRes.json()) as GarminActivityDetail;

    // Convert activity to Ride format
    const distanceMiles = activityDetail.distanceInMeters
      ? activityDetail.distanceInMeters * 0.000621371
      : 0;

    const elevationGainFeet = (activityDetail.totalElevationGainInMeters ?? activityDetail.elevationGainInMeters)
      ? (activityDetail.totalElevationGainInMeters ?? activityDetail.elevationGainInMeters)! * 3.28084
      : 0;

    const startTime = new Date(activityDetail.startTimeInSeconds * 1000);

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
      },
      update: {
        startTime,
        durationSeconds: activityDetail.durationInSeconds,
        distanceMiles,
        elevationGainFeet,
        averageHr: activityDetail.averageHeartRateInBeatsPerMinute ?? null,
        rideType: activityDetail.activityType,
        notes: activityDetail.activityName ?? null,
      },
    });

    console.log(`[Garmin Activities PING] Successfully stored ride for activity ${summaryId}`);
  } catch (error) {
    console.error(`[Garmin Activities PING] Error fetching/storing activity ${summaryId}:`, error);
    throw error;
  }
}

export default r;
