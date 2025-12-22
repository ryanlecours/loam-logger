import { Router as createRouter, type Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma';

type Empty = Record<string, never>;
const r: Router = createRouter();

/**
 * Get all duplicate rides for a user
 */
r.get('/duplicates', async (req: Request, res: Response) => {
  const userId = req.user?.id || req.sessionUser?.uid;
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    // Find all rides that have duplicates
    const ridesWithDuplicates = await prisma.ride.findMany({
      where: {
        userId,
        duplicates: {
          some: {},
        },
      },
      include: {
        duplicates: {
          select: {
            id: true,
            startTime: true,
            durationSeconds: true,
            distanceMiles: true,
            elevationGainFeet: true,
            garminActivityId: true,
            stravaActivityId: true,
            rideType: true,
            notes: true,
            createdAt: true,
          },
        },
      },
      orderBy: { startTime: 'desc' },
    });

    return res.json({
      success: true,
      duplicates: ridesWithDuplicates,
    });
  } catch (error) {
    console.error('[Duplicates] Error fetching:', error);
    return res.status(500).json({ error: 'Failed to fetch duplicates' });
  }
});

/**
 * Merge duplicates - keep one, delete the other
 */
r.post<Empty, void, { keepRideId: string; deleteRideId: string }>(
  '/duplicates/merge',
  async (req: Request<Empty, void, { keepRideId: string; deleteRideId: string }>, res: Response) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { keepRideId, deleteRideId } = req.body;

    if (!keepRideId || !deleteRideId) {
      return res.status(400).json({ error: 'Missing keepRideId or deleteRideId' });
    }

    try {
      // Verify both rides belong to this user
      const [keepRide, deleteRide] = await Promise.all([
        prisma.ride.findUnique({ where: { id: keepRideId }, select: { userId: true } }),
        prisma.ride.findUnique({ where: { id: deleteRideId }, select: { userId: true } }),
      ]);

      if (!keepRide || !deleteRide) {
        return res.status(404).json({ error: 'One or both rides not found' });
      }

      if (keepRide.userId !== userId || deleteRide.userId !== userId) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      // Delete the duplicate
      await prisma.ride.delete({
        where: { id: deleteRideId },
      });

      // Clear duplicate flags on the kept ride
      await prisma.ride.update({
        where: { id: keepRideId },
        data: {
          isDuplicate: false,
          duplicateOfId: null,
        },
      });

      console.log(`[Duplicates] Merged: kept ${keepRideId}, deleted ${deleteRideId}`);

      return res.json({
        success: true,
        message: 'Rides merged successfully',
        keptRideId: keepRideId,
      });
    } catch (error) {
      console.error('[Duplicates] Error merging:', error);
      return res.status(500).json({ error: 'Failed to merge rides' });
    }
  }
);

/**
 * Mark rides as NOT duplicates (false positive)
 */
r.post<Empty, void, { rideId: string }>(
  '/duplicates/mark-not-duplicate',
  async (req: Request<Empty, void, { rideId: string }>, res: Response) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { rideId } = req.body;

    try {
      const ride = await prisma.ride.findUnique({
        where: { id: rideId },
        select: { userId: true, duplicateOfId: true },
      });

      if (!ride) {
        return res.status(404).json({ error: 'Ride not found' });
      }

      if (ride.userId !== userId) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      // Clear duplicate flags
      await prisma.ride.update({
        where: { id: rideId },
        data: {
          isDuplicate: false,
          duplicateOfId: null,
        },
      });

      return res.json({
        success: true,
        message: 'Ride marked as not duplicate',
      });
    } catch (error) {
      console.error('[Duplicates] Error marking:', error);
      return res.status(500).json({ error: 'Failed to update ride' });
    }
  }
);

export default r;
