import {
  Router as createRouter,
  type Router,
  type Request,
  type Response,
  type RequestHandler,
} from 'express';
import { garminGetActivities } from '../services/garmin';
import { sendUnauthorized, sendSuccess, sendError, sendInternalError } from '../lib/api-response';
import { prisma } from '../lib/prisma';

const r: Router = createRouter();

const requireUser: RequestHandler = (req, res, next) => {
  if (!req.user?.id) {
    sendUnauthorized(res);
    return;
  }
  next();
};

type Params = Record<string, never>;
type Query = { limit?: string; from?: string; to?: string };

r.get<Params, unknown, never, Query>(
  '/me/garmin/activities',
  requireUser,
  async (
    req: Request<Params, unknown, never, Query>,
    res: Response
  ) => {
    try {
      const userId = req.user!.id; // safe after requireUser
      const parsedLimit = Number.isFinite(Number(req.query.limit))
        ? Math.min(100, Math.max(1, Number(req.query.limit)))
        : 5;

      const params: Record<string, string> = { limit: String(parsedLimit) };
      if (req.query.from) params.from = req.query.from;
      if (req.query.to) params.to = req.query.to;

      const data = await garminGetActivities(userId, params);
      sendSuccess(res, data);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch activities';
      sendError(res, 502, msg, 'GARMIN_API_ERROR');
      return;
    }
  }
);

/**
 * Testing/utility endpoint: Delete all Garmin-imported rides for the current user.
 * Also removes the recorded hours from associated bikes/components.
 */
r.delete<Params, unknown, never>(
  '/garmin/testing/delete-imported-rides',
  requireUser,
  async (req: Request, res: Response) => {
    const userId = req.user!.id;

    try {
      const rides = await prisma.ride.findMany({
        where: {
          userId,
          garminActivityId: { not: null },
        },
        select: { id: true, durationSeconds: true, bikeId: true },
      });

      if (rides.length === 0) {
        return res.json({
          success: true,
          deletedRides: 0,
          message: 'No Garmin rides to delete',
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
          if (hours <= 0) continue;
          await tx.component.updateMany({
            where: { userId, bikeId },
            data: { hoursUsed: { decrement: hours } },
          });
          await tx.component.updateMany({
            where: { userId, bikeId, hoursUsed: { lt: 0 } },
            data: { hoursUsed: 0 },
          });
        }

        await tx.ride.deleteMany({
          where: {
            userId,
            garminActivityId: { not: null },
          },
        });
      });

      return res.json({
        success: true,
        deletedRides: rides.length,
        adjustedBikes: hoursByBike.size,
      });
    } catch (error) {
      console.error('[Garmin Delete Rides] Error:', error);
      return sendInternalError(res, 'Failed to delete Garmin rides');
    }
  }
);

export default r;
