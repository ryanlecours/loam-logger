import { Router as createRouter, type Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma.ts';
import { getValidStravaToken } from '../lib/strava-token.ts';

type Empty = Record<string, never>;
const r: Router = createRouter();

/**
 * Webhook verification (GET request)
 * Strava sends this once to verify the callback URL
 * Spec: https://developers.strava.com/docs/webhooks/
 */
r.get<Empty, void, Empty, { 'hub.mode'?: string; 'hub.challenge'?: string; 'hub.verify_token'?: string }>(
  '/webhooks/strava',
  async (req: Request<Empty, void, Empty, { 'hub.mode'?: string; 'hub.challenge'?: string; 'hub.verify_token'?: string }>, res: Response) => {
    const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': verifyToken } = req.query;

    console.log('[Strava Webhook Verification] Received verification request:', {
      mode,
      challenge,
      verifyToken: verifyToken ? 'present' : 'missing',
    });

    const VERIFY_TOKEN = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;

    if (!VERIFY_TOKEN) {
      console.error('[Strava Webhook Verification] STRAVA_WEBHOOK_VERIFY_TOKEN not set');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    if (mode === 'subscribe' && verifyToken === VERIFY_TOKEN && challenge) {
      console.log('[Strava Webhook Verification] Verification successful');
      return res.json({ 'hub.challenge': challenge });
    }

    console.warn('[Strava Webhook Verification] Verification failed');
    return res.status(403).json({ error: 'Forbidden' });
  }
);

/**
 * Activity events webhook (POST request)
 * Receives events for ALL users (single subscription per app)
 * Spec: https://developers.strava.com/docs/webhooks/
 */
type StravaWebhookEvent = {
  object_type: string; // 'activity' or 'athlete'
  object_id: number; // activity ID or athlete ID
  aspect_type: string; // 'create', 'update', or 'delete'
  owner_id: number; // athlete ID who owns the object
  subscription_id: number;
  event_time: number; // Unix timestamp
  updates?: Record<string, unknown>;
};

r.post<Empty, void, StravaWebhookEvent>(
  '/webhooks/strava',
  async (req: Request<Empty, void, StravaWebhookEvent>, res: Response) => {
    console.log(`[Strava Webhook] Incoming event at ${new Date().toISOString()}`);
    console.log(`[Strava Webhook] Payload:`, JSON.stringify(req.body, null, 2));

    try {
      const event = req.body;

      // Respond immediately to Strava (required within 2 seconds)
      res.status(200).send('EVENT_RECEIVED');

      // Process event asynchronously
      if (event.object_type === 'activity') {
        await processActivityEvent(event);
      } else if (event.object_type === 'athlete') {
        // Handle athlete events (subscription updates, deauthorization)
        console.log(`[Strava Webhook] Athlete event ${event.aspect_type} for athlete ${event.owner_id}`);
      }
    } catch (error) {
      console.error('[Strava Webhook] Error processing event:', error);
      // Already responded to Strava, just log the error
    }
  }
);

/**
 * Deauthorization webhook (optional endpoint for clarity)
 * Called when a user revokes access to the app
 */
r.post<Empty, void, { athlete_id: number }>(
  '/webhooks/strava/deauthorization',
  async (req: Request<Empty, void, { athlete_id: number }>, res: Response) => {
    try {
      const { athlete_id } = req.body;

      console.log(`[Strava Deauthorization] Athlete ${athlete_id} revoked access`);

      // Find user by Strava athlete ID
      const userAccount = await prisma.userAccount.findUnique({
        where: {
          provider_providerUserId: {
            provider: 'strava',
            providerUserId: athlete_id.toString(),
          },
        },
      });

      if (!userAccount) {
        console.warn(`[Strava Deauthorization] Unknown Strava athlete ID: ${athlete_id}`);
        return res.status(200).send('OK');
      }

      // Get user to check if Strava is the active source
      const user = await prisma.user.findUnique({
        where: { id: userAccount.userId },
        select: { activeDataSource: true },
      });

      // Delete tokens and account record
      await prisma.$transaction([
        prisma.oauthToken.deleteMany({
          where: {
            userId: userAccount.userId,
            provider: 'strava',
          },
        }),
        prisma.userAccount.delete({
          where: {
            provider_providerUserId: {
              provider: 'strava',
              providerUserId: athlete_id.toString(),
            },
          },
        }),
        prisma.user.update({
          where: { id: userAccount.userId },
          data: {
            stravaUserId: null,
            ...(user?.activeDataSource === 'strava' ? { activeDataSource: null } : {}),
          },
        }),
      ]);

      console.log(`[Strava Deauthorization] Removed Strava connection for userId: ${userAccount.userId}`);
      return res.status(200).send('OK');
    } catch (error) {
      console.error('[Strava Deauthorization] Error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * Process a single Strava activity event
 */
async function processActivityEvent(event: StravaWebhookEvent): Promise<void> {
  const { object_id: activityId, aspect_type, owner_id: athleteId } = event;

  console.log(`[Strava Activity Event] ${aspect_type} for activity ${activityId}, athlete ${athleteId}`);

  // Find user by Strava athlete ID
  const userAccount = await prisma.userAccount.findUnique({
    where: {
      provider_providerUserId: {
        provider: 'strava',
        providerUserId: athleteId.toString(),
      },
    },
  });

  if (!userAccount) {
    console.warn(`[Strava Activity Event] Unknown Strava athlete ID: ${athleteId}`);
    return;
  }

  console.log(`[Strava Activity Event] Found user: ${userAccount.userId}`);

  // Check user's active data source
  const user = await prisma.user.findUnique({
    where: { id: userAccount.userId },
    select: { activeDataSource: true },
  });

  if (user?.activeDataSource && user.activeDataSource !== 'strava') {
    console.log(`[Strava Activity Event] User's active source is ${user.activeDataSource}, skipping Strava activity`);
    return;
  }

  // Handle different event types
  if (aspect_type === 'delete') {
    // Delete ride
    await prisma.ride.deleteMany({
      where: {
        userId: userAccount.userId,
        stravaActivityId: activityId.toString(),
      },
    });
    console.log(`[Strava Activity Event] Deleted ride for activity ${activityId}`);
    return;
  }

  if (aspect_type === 'create' || aspect_type === 'update') {
    // Fetch full activity details from Strava API
    const accessToken = await getValidStravaToken(userAccount.userId);

    if (!accessToken) {
      console.error(`[Strava Activity Event] No valid access token for user ${userAccount.userId}`);
      return;
    }

    const activityUrl = `https://www.strava.com/api/v3/activities/${activityId}`;

    try {
      const activityRes = await fetch(activityUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (!activityRes.ok) {
        const text = await activityRes.text();
        console.error(`[Strava Activity Event] Failed to fetch activity ${activityId}: ${activityRes.status} ${text}`);
        return;
      }

      type StravaActivityDetail = {
        id: number;
        name: string;
        sport_type: string;
        start_date: string; // ISO 8601
        elapsed_time: number; // seconds
        moving_time: number; // seconds
        distance: number; // meters
        total_elevation_gain: number; // meters
        gear_id?: string | null; // Strava bike/gear ID
        average_heartrate?: number;
        max_heartrate?: number;
        average_speed?: number; // m/s
        max_speed?: number; // m/s
        calories?: number;
        [key: string]: unknown;
      };

      const activity = (await activityRes.json()) as StravaActivityDetail;

      // Filter: Only process cycling activities
      const CYCLING_SPORT_TYPES = [
        'Ride',
        'MountainBikeRide',
        'GravelRide',
        'VirtualRide',
        'EBikeRide',
        'EMountainBikeRide',
        'Handcycle',
      ];

      if (!CYCLING_SPORT_TYPES.includes(activity.sport_type)) {
        console.log(`[Strava Activity Event] Skipping non-cycling activity: ${activity.sport_type}`);
        return;
      }

      console.log(`[Strava Activity Event] Processing cycling activity: ${activity.sport_type}`);

      // Convert activity to Ride format
      const distanceMiles = activity.distance * 0.000621371; // meters to miles
      const elevationGainFeet = activity.total_elevation_gain * 3.28084; // meters to feet
      const startTime = new Date(activity.start_date);

      // Look up bike mapping if gear_id exists
      let bikeId: string | null = null;
      if (activity.gear_id) {
        const mapping = await prisma.stravaGearMapping.findUnique({
          where: {
            userId_stravaGearId: {
              userId: userAccount.userId,
              stravaGearId: activity.gear_id,
            },
          },
        });
        bikeId = mapping?.bikeId ?? null;
      }

      // If no bike assigned yet, check if user has exactly one bike (auto-assign)
      if (!bikeId) {
        const userBikes = await prisma.bike.findMany({
          where: { userId: userAccount.userId },
          select: { id: true },
        });
        if (userBikes.length === 1) {
          bikeId = userBikes[0].id;
        }
      }

      // Upsert the ride
      await prisma.ride.upsert({
        where: {
          stravaActivityId: activityId.toString(),
        },
        create: {
          userId: userAccount.userId,
          stravaActivityId: activityId.toString(),
          stravaGearId: activity.gear_id ?? null,
          startTime,
          durationSeconds: activity.moving_time,
          distanceMiles,
          elevationGainFeet,
          averageHr: activity.average_heartrate ? Math.round(activity.average_heartrate) : null,
          rideType: activity.sport_type,
          notes: activity.name || null,
          bikeId,
        },
        update: {
          startTime,
          stravaGearId: activity.gear_id ?? null,
          durationSeconds: activity.moving_time,
          distanceMiles,
          elevationGainFeet,
          averageHr: activity.average_heartrate ? Math.round(activity.average_heartrate) : null,
          rideType: activity.sport_type,
          notes: activity.name || null,
          bikeId,
        },
      });

      console.log(`[Strava Activity Event] Successfully stored ride for activity ${activityId}`);
    } catch (error) {
      console.error(`[Strava Activity Event] Error fetching/storing activity ${activityId}:`, error);
      throw error;
    }
  }
}

export default r;
