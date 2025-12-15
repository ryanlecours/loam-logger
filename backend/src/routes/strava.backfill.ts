import { Router as createRouter, type Router, type Request, type Response } from 'express';
import { getValidStravaToken } from '../lib/strava-token.ts';
import { subDays } from 'date-fns';
import { prisma } from '../lib/prisma.ts';

type Empty = Record<string, never>;
const r: Router = createRouter();

/**
 * Fetch historical activities from Strava for a given time period
 * Returns activities that have been imported
 */
r.get<Empty, void, Empty, { days?: string }>(
  '/strava/backfill/fetch',
  async (req: Request<Empty, void, Empty, { days?: string }>, res: Response) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
      const days = parseInt(req.query.days || '30', 10);
      if (isNaN(days) || days < 1 || days > 365) {
        return res.status(400).json({ error: 'Days must be between 1 and 365' });
      }

      // Get valid OAuth token
      const accessToken = await getValidStravaToken(userId);

      if (!accessToken) {
        return res.status(400).json({
          error: 'Strava not connected or token expired. Please reconnect your Strava account.'
        });
      }

      // Calculate date range (Unix timestamps)
      const endDate = new Date();
      const startDate = subDays(endDate, days);
      const afterTimestamp = Math.floor(startDate.getTime() / 1000);
      const beforeTimestamp = Math.floor(endDate.getTime() / 1000);

      console.log(`[Strava Backfill] Fetching activities from ${startDate.toISOString()} to ${endDate.toISOString()}`);

      // Fetch activities from Strava API
      // https://developers.strava.com/docs/reference/#api-Activities-getLoggedInAthleteActivities
      const activities: StravaActivity[] = [];
      let page = 1;
      const perPage = 50; // Strava max is 200, but 50 is safer
      let hasMore = true;

      while (hasMore) {
        const url = new URL('https://www.strava.com/api/v3/athlete/activities');
        url.searchParams.set('after', afterTimestamp.toString());
        url.searchParams.set('before', beforeTimestamp.toString());
        url.searchParams.set('page', page.toString());
        url.searchParams.set('per_page', perPage.toString());

        const activitiesRes = await fetch(url.toString(), {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        });

        if (!activitiesRes.ok) {
          const text = await activitiesRes.text();
          console.error(`[Strava Backfill] Failed to fetch activities: ${activitiesRes.status} ${text}`);
          throw new Error(`Failed to fetch activities: ${activitiesRes.status}`);
        }

        const pageActivities = (await activitiesRes.json()) as StravaActivity[];
        activities.push(...pageActivities);

        console.log(`[Strava Backfill] Fetched page ${page}: ${pageActivities.length} activities`);

        if (pageActivities.length < perPage) {
          hasMore = false;
        } else {
          page++;
        }

        // Safety: Limit to 10 pages (500 activities max)
        if (page > 10) {
          console.warn('[Strava Backfill] Reached page limit (10), stopping pagination');
          hasMore = false;
        }
      }

      console.log(`[Strava Backfill] Total activities fetched: ${activities.length}`);

      // Filter cycling activities
      const CYCLING_SPORT_TYPES = [
        'Ride',
        'MountainBikeRide',
        'GravelRide',
        'VirtualRide',
        'EBikeRide',
        'EMountainBikeRide',
        'Handcycle',
      ];

      const cyclingActivities = activities.filter((a) =>
        CYCLING_SPORT_TYPES.includes(a.sport_type)
      );

      console.log(`[Strava Backfill] Cycling activities: ${cyclingActivities.length}`);

      // Import each cycling activity
      let importedCount = 0;
      let skippedCount = 0;

      for (const activity of cyclingActivities) {
        // Check if activity already exists
        const existing = await prisma.ride.findUnique({
          where: { stravaActivityId: activity.id.toString() },
        });

        if (existing) {
          skippedCount++;
          continue;
        }

        // Look up bike mapping if gear_id exists
        let bikeId: string | null = null;
        if (activity.gear_id) {
          const mapping = await prisma.stravaGearMapping.findUnique({
            where: {
              userId_stravaGearId: {
                userId,
                stravaGearId: activity.gear_id,
              },
            },
          });
          bikeId = mapping?.bikeId ?? null;
        }

        // Convert activity to Ride format
        const distanceMiles = activity.distance * 0.000621371; // meters to miles
        const elevationGainFeet = activity.total_elevation_gain * 3.28084; // meters to feet
        const startTime = new Date(activity.start_date);

        await prisma.ride.create({
          data: {
            userId,
            stravaActivityId: activity.id.toString(),
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
        });

        importedCount++;
      }

      console.log(`[Strava Backfill] Imported: ${importedCount}, Skipped (existing): ${skippedCount}`);

      // Detect unmapped gears
      const unmappedGearIds = cyclingActivities
        .filter((a) => a.gear_id)
        .map((a) => a.gear_id!)
        .filter((id, idx, arr) => arr.indexOf(id) === idx);

      const unmappedGears: Array<{ gearId: string; rideCount: number }> = [];
      for (const gearId of unmappedGearIds) {
        const mapping = await prisma.stravaGearMapping.findUnique({
          where: {
            userId_stravaGearId: { userId, stravaGearId: gearId },
          },
        });
        if (!mapping) {
          const rideCount = cyclingActivities.filter((a) => a.gear_id === gearId).length;
          unmappedGears.push({ gearId, rideCount });
        }
      }

      console.log(`[Strava Backfill] Unmapped gears: ${unmappedGears.length}`);

      return res.json({
        success: true,
        message: `Successfully imported ${importedCount} rides from Strava.`,
        totalActivities: activities.length,
        cyclingActivities: cyclingActivities.length,
        imported: importedCount,
        skipped: skippedCount,
        unmappedGears,
      });
    } catch (error) {
      console.error('[Strava Backfill] Error:', error);
      return res.status(500).json({ error: 'Failed to fetch activities' });
    }
  }
);

/**
 * Get the user's Strava Athlete ID
 */
r.get<Empty, void, Empty, Empty>(
  '/strava/backfill/strava-athlete-id',
  async (req: Request<Empty, void, Empty, Empty>, res: Response) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
      const userAccount = await prisma.userAccount.findFirst({
        where: {
          userId,
          provider: 'strava',
        },
        select: {
          providerUserId: true,
        },
      });

      if (!userAccount) {
        return res.status(404).json({ error: 'Strava account not connected' });
      }

      return res.json({
        stravaAthleteId: userAccount.providerUserId,
        message: 'Your Strava athlete ID',
      });
    } catch (error) {
      console.error('[Strava Athlete ID] Error:', error);
      return res.status(500).json({ error: 'Failed to fetch Strava athlete ID' });
    }
  }
);

/**
 * Check recent Strava ride imports
 * Useful for debugging backfill issues
 */
r.get<Empty, void, Empty, Empty>(
  '/strava/backfill/status',
  async (req: Request<Empty, void, Empty, Empty>, res: Response) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
      // Get recent rides imported from Strava (last 30 days)
      const thirtyDaysAgo = subDays(new Date(), 30);
      const recentStravaRides = await prisma.ride.findMany({
        where: {
          userId,
          stravaActivityId: { not: null },
          startTime: { gte: thirtyDaysAgo },
        },
        orderBy: { startTime: 'desc' },
        take: 50,
        select: {
          id: true,
          stravaActivityId: true,
          startTime: true,
          rideType: true,
          distanceMiles: true,
          createdAt: true,
        },
      });

      // Get total Strava rides for this user
      const totalStravaRides = await prisma.ride.count({
        where: {
          userId,
          stravaActivityId: { not: null },
        },
      });

      return res.json({
        success: true,
        recentRides: recentStravaRides,
        totalStravaRides,
        message: `Found ${recentStravaRides.length} recent Strava rides (last 30 days), ${totalStravaRides} total`,
      });
    } catch (error) {
      console.error('[Strava Backfill Status] Error:', error);
      return res.status(500).json({ error: 'Failed to fetch backfill status' });
    }
  }
);

/**
 * Fetch Strava gear details
 */
r.get<{ gearId: string }, void, Empty, Empty>(
  '/strava/gear/:gearId',
  async (req: Request<{ gearId: string }, void, Empty, Empty>, res: Response) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
      const { gearId } = req.params;
      const accessToken = await getValidStravaToken(userId);

      if (!accessToken) {
        return res.status(400).json({ error: 'Strava not connected' });
      }

      const gearUrl = `https://www.strava.com/api/v3/gear/${gearId}`;
      const gearRes = await fetch(gearUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (!gearRes.ok) {
        return res.status(404).json({ error: 'Gear not found' });
      }

      const gear = (await gearRes.json()) as {
        id: string;
        name: string;
        brand_name?: string;
        model_name?: string;
      };

      return res.json({
        id: gear.id,
        name: gear.name,
        brand: gear.brand_name,
        model: gear.model_name,
      });
    } catch (error) {
      console.error('[Strava Gear] Error:', error);
      return res.status(500).json({ error: 'Failed to fetch gear' });
    }
  }
);

// Type definitions for Strava API responses
type StravaActivity = {
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
  [key: string]: unknown;
};

export default r;
