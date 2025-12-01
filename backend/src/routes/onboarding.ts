import express, { type Request } from 'express';
import { prisma } from '../lib/prisma';
import { type SessionUser } from '../auth/session';
import { type ComponentType } from '@prisma/client';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      sessionUser?: SessionUser;
    }
  }
}

const router = express.Router();

/**
 * POST /onboarding/complete
 * Save onboarding data and create initial bike with components
 * Requires authenticated session
 */
router.post('/complete', express.json(), async (req: Request, res) => {
  try {
    const sessionUser = req.sessionUser;

    // Verify user is authenticated
    if (!sessionUser?.uid) {
      return res.status(401).json({ message: 'Unauthorized: No active session' });
    }

    const { age, location, bikeYear, bikeMake, bikeModel, components } = req.body as {
      age?: number;
      location?: string;
      bikeYear?: number;
      bikeMake?: string;
      bikeModel?: string;
      components?: {
        fork?: string;
        rearShock?: string;
        wheels?: string;
        dropperPost?: string;
      };
    };

    // Validate bike data
    if (!bikeMake || !bikeModel) {
      return res.status(400).json({ message: 'Bike make and model are required' });
    }

    if (age && (age < 16 || age > 150)) {
      return res.status(400).json({ message: 'Please enter a valid age' });
    }

    const userId = sessionUser.uid;

    // Use transaction to ensure atomicity: all writes succeed or all fail
    const result = await prisma.$transaction(async (tx) => {
      // Update user with onboarding data
      const user = await tx.user.update({
        where: { id: userId },
        data: {
          age: age || null,
          location: location || null,
          onboardingCompleted: true,
        },
      });

      console.log(`[Onboarding] Updated user profile for: ${userId}`);

      // Create bike
      const bike = await tx.bike.create({
        data: {
          userId,
          manufacturer: bikeMake,
          model: bikeModel,
          year: bikeYear || null,
        },
      });

      console.log(`[Onboarding] Created bike for user: ${userId}`);

      // Create components if provided
      const componentTypeMap: Record<string, ComponentType> = {
        fork: 'FORK',
        rearShock: 'SHOCK',
        wheels: 'WHEELS',
        dropperPost: 'DROPPER',
      };

      if (components) {
        for (const [key, value] of Object.entries(components)) {
          if (value && value.trim().length > 0) {
            const componentType = componentTypeMap[key];
            if (componentType) {
              const [brand, ...modelParts] = value.trim().split(' ');
              const model = modelParts.join(' ') || brand;

              await tx.component.create({
                data: {
                  userId,
                  bikeId: bike.id,
                  type: componentType,
                  brand: brand,
                  model: model,
                  hoursUsed: 0,
                },
              });

              console.log(`[Onboarding] Created ${componentType} component for bike: ${bike.id}`);
            }
          }
        }
      }

      // Always create stock Pivot Bearings component for new bikes
      await tx.component.create({
        data: {
          userId,
          bikeId: bike.id,
          type: 'PIVOT_BEARINGS',
          brand: 'Stock',
          model: 'Stock',
          hoursUsed: 0,
          isStock: true,
        },
      });

      console.log(`[Onboarding] Created stock Pivot Bearings component for bike: ${bike.id}`);

      return { user, bike };
    });

    res.status(200).json({
      ok: true,
      message: 'Onboarding completed successfully',
      bikeId: result.bike.id,
    });
  } catch (error) {
    console.error('[Onboarding] Error completing onboarding:', error);

    res.status(500).json({
      message: 'An error occurred while completing onboarding. Please try again.',
    });
  }
});

export default router;
