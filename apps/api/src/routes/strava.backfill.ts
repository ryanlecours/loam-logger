import { Router as createRouter, type Router, type Request, type Response } from 'express';
import { getValidStravaToken } from '../lib/strava-token';
import { subDays } from 'date-fns';
import { prisma } from '../lib/prisma';
import { formatLatLon, reverseGeocode } from '../lib/location';
import { sendBadRequest, sendUnauthorized, sendNotFound, sendInternalError } from '../lib/api-response';
import { incrementBikeComponentHours, decrementBikeComponentHours } from '../lib/component-hours';
import { logError } from '../lib/logger';

type Empty = Record<string, never>;
const r: Router = createRouter();

/**
 * Fetch historical activities from Strava for a given time period
 * Returns activities that have been imported
 */
r.get<Empty, void, Empty, { year?: string }>(
  '/strava/backfill/fetch',
  async (req: Request<Empty, void, Empty, { year?: string }>, res: Response) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return sendUnauthorized(res, 'Not authenticated');
    }

    try {
      const currentYear = new Date().getFullYear();
      const yearParam = req.query.year;

      let startDate: Date;
      let endDate: Date;

      if (yearParam === 'ytd') {
        // Year-to-date: Jan 1 of current year to now
        startDate = new Date(currentYear, 0, 1); // Jan 1
        endDate = new Date(); // Now
      } else {
        // Specific year: Jan 1 to Dec 31
        const year = parseInt(yearParam || String(currentYear), 10);
        if (isNaN(year) || year < 2000 || year > currentYear) {
          return sendBadRequest(res, `Year must be between 2000 and ${currentYear}, or 'ytd'`);
        }
        startDate = new Date(year, 0, 1); // Jan 1
        endDate = new Date(year, 11, 31, 23, 59, 59); // Dec 31 end of day
      }

      // Get valid OAuth token
      const accessToken = await getValidStravaToken(userId);

      if (!accessToken) {
        return sendBadRequest(res, 'Strava not connected or token expired. Please reconnect your Strava account.');
      }

      // Calculate Unix timestamps
      const afterTimestamp = Math.floor(startDate.getTime() / 1000);
      const beforeTimestamp = Math.floor(endDate.getTime() / 1000);

      console.log(`[Strava Backfill] Fetching ${yearParam || currentYear} activities from ${startDate.toISOString()} to ${endDate.toISOString()}`);

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

        // Safety: Limit to 50 pages (2500 activities max)
        if (page > 50) {
          console.warn('[Strava Backfill] Reached page limit (50), stopping pagination');
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
      let geocodedCount = 0;

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

        // If no bike assigned yet, check if user has exactly one bike (auto-assign)
        if (!bikeId) {
          const userBikes = await prisma.bike.findMany({
            where: { userId },
            select: { id: true },
          });
          if (userBikes.length === 1) {
            bikeId = userBikes[0].id;
          }
        }

        // Convert activity to Ride format
        const distanceMiles = activity.distance * 0.000621371; // meters to miles
        const elevationGainFeet = activity.total_elevation_gain * 3.28084; // meters to feet
        const startTime = new Date(activity.start_date);

        const durationHours = Math.max(0, activity.moving_time) / 3600;
        const lat = activity.start_latlng?.[0] ?? null;
        const lon = activity.start_latlng?.[1] ?? null;
        // Use lat/lon format initially, geocode in background
        const initialLocation = formatLatLon(lat, lon);

        const ride = await prisma.$transaction(async (tx) => {
          const createdRide = await tx.ride.create({
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
              location: initialLocation,
            },
          });

          if (bikeId) {
            await incrementBikeComponentHours(tx, { userId, bikeId, hoursDelta: durationHours });
          }

          return createdRide;
        });

        // Geocode synchronously if we have coordinates
        if (lat !== null && lon !== null) {
          try {
            const locationResult = await reverseGeocode(lat, lon);
            if (locationResult) {
              await prisma.ride.update({
                where: { id: ride.id },
                data: { location: locationResult.title },
              });
              geocodedCount++;
            }
          } catch (err) {
            // Don't fail the import if geocoding fails
            console.warn(`[Strava Backfill] Failed to geocode ride ${ride.id}:`, err);
          }
        }

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

      // Track backfill request in database
      const yearKey = yearParam || 'ytd';
      try {
        await prisma.backfillRequest.upsert({
          where: { userId_provider_year: { userId, provider: 'strava', year: yearKey } },
          update: {
            status: 'completed',
            ridesFound: importedCount,
            completedAt: new Date(),
            updatedAt: new Date(),
          },
          create: {
            userId,
            provider: 'strava',
            year: yearKey,
            status: 'completed',
            ridesFound: importedCount,
            completedAt: new Date(),
          },
        });
      } catch (dbError) {
        logError('Strava Backfill DB tracking', dbError);
        // Don't fail the request if tracking fails
      }

      return res.json({
        success: true,
        message: `Successfully imported ${importedCount} rides from Strava.`,
        totalActivities: activities.length,
        cyclingActivities: cyclingActivities.length,
        imported: importedCount,
        skipped: skippedCount,
        geocoded: geocodedCount,
        unmappedGears,
      });
    } catch (error) {
      // Track failed backfill - use req.query.year since yearParam is scoped to try block
      const yearKey = req.query.year || 'ytd';
      try {
        await prisma.backfillRequest.upsert({
          where: { userId_provider_year: { userId, provider: 'strava', year: yearKey } },
          update: { status: 'failed', updatedAt: new Date() },
          create: { userId, provider: 'strava', year: yearKey, status: 'failed' },
        });
      } catch {
        // Ignore tracking errors
      }
      logError('Strava Backfill', error);
      return sendInternalError(res, 'Failed to fetch activities');
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
      return sendUnauthorized(res, 'Not authenticated');
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
        return sendNotFound(res, 'Strava account not connected');
      }

      return res.json({
        stravaAthleteId: userAccount.providerUserId,
        message: 'Your Strava athlete ID',
      });
    } catch (error) {
      logError('Strava Athlete ID', error);
      return sendInternalError(res, 'Failed to fetch Strava athlete ID');
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
      return sendUnauthorized(res, 'Not authenticated');
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
      logError('Strava Backfill Status', error);
      return sendInternalError(res, 'Failed to fetch backfill status');
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
      return sendUnauthorized(res, 'Not authenticated');
    }

    try {
      const { gearId } = req.params;
      const accessToken = await getValidStravaToken(userId);

      if (!accessToken) {
        return sendBadRequest(res, 'Strava not connected');
      }

      const gearUrl = `https://www.strava.com/api/v3/gear/${gearId}`;
      const gearRes = await fetch(gearUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (!gearRes.ok) {
        return sendNotFound(res, 'Gear not found');
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
      logError('Strava Gear', error);
      return sendInternalError(res, 'Failed to fetch gear');
    }
  }
);

/**
 * Testing/utility endpoint: Delete all Strava-imported rides for the current user.
 * Also removes the recorded hours from associated bikes/components.
 */
r.delete<Empty, void, Empty>(
  '/strava/testing/delete-imported-rides',
  async (req: Request, res: Response) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return sendUnauthorized(res, 'Not authenticated');
    }

    try {
      const rides = await prisma.ride.findMany({
        where: {
          userId,
          stravaActivityId: { not: null },
        },
        select: { id: true, durationSeconds: true, bikeId: true },
      });

      if (rides.length === 0) {
        return res.json({
          success: true,
          deletedRides: 0,
          message: 'No Strava rides to delete',
        });
      }

      const hoursByBike = rides.reduce<Map<string, number>>((map, ride) => {
        if (ride.bikeId) {
          const hours = Math.max(0, ride.durationSeconds ?? 0) / 3600;
          map.set(ride.bikeId, (map.get(ride.bikeId) ?? 0) + hours);
        }
        return map;
      }, new Map());

      await prisma.$transaction(async (tx) => {
        for (const [bikeId, hours] of hoursByBike.entries()) {
          await decrementBikeComponentHours(tx, { userId, bikeId, hoursDelta: hours });
        }

        await tx.ride.deleteMany({
          where: {
            userId,
            stravaActivityId: { not: null },
          },
        });
      });

      return res.json({
        success: true,
        deletedRides: rides.length,
        adjustedBikes: hoursByBike.size,
      });
    } catch (error) {
      logError('Strava Delete Rides', error);
      return sendInternalError(res, 'Failed to delete Strava rides');
    }
  }
);

// Type definitions for Strava API responses
// Based on: https://developers.strava.com/docs/reference/#api-Activities-getLoggedInAthleteActivities
type StravaActivity = {
  id: number;
  name: string;
  type: string; // e.g., "Ride"
  sport_type: string; // e.g., "MountainBikeRide", "GravelRide"
  start_date: string; // ISO 8601 UTC
  start_date_local: string; // ISO 8601 local
  timezone: string; // e.g., "(GMT-08:00) America/Los_Angeles"
  elapsed_time: number; // seconds
  moving_time: number; // seconds
  distance: number; // meters
  total_elevation_gain: number; // meters
  gear_id: string | null; // Strava bike/gear ID
  average_heartrate?: number;
  max_heartrate?: number;
  average_speed?: number; // m/s
  max_speed?: number; // m/s
  // Location coordinates - we use these for reverse geocoding
  start_latlng: [number, number] | null;
  end_latlng: [number, number] | null;
  // Note: location_city/state/country are unreliable, so we ignore them
  // Additional fields from sample
  trainer?: boolean;
  commute?: boolean;
  manual?: boolean;
  private?: boolean;
  device_name?: string;
  average_watts?: number;
  kilojoules?: number;
  suffer_score?: number;
};

export default r;
