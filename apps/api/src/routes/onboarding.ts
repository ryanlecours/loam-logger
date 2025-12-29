import express, { type Request } from 'express';
import { prisma } from '../lib/prisma';
import { type SessionUser } from '../auth/session';
import { type ComponentType } from '@prisma/client';
import { sendBadRequest, sendUnauthorized, sendInternalError } from '../lib/api-response';

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
      return sendUnauthorized(res, 'No active session');
    }

    const {
      age,
      location,
      bikeYear,
      bikeMake,
      bikeModel,
      bikeTravelFork,
      bikeTravelShock,
      spokesId,
      // New 99spokes metadata fields
      spokesUrl,
      thumbnailUrl,
      family,
      category,
      subcategory,
      buildKind,
      isFrameset,
      isEbike,
      gender,
      frameMaterial,
      hangerStandard,
      // E-bike motor/battery specs
      motorMaker,
      motorModel,
      motorPowerW,
      motorTorqueNm,
      batteryWh,
      // Components (legacy format)
      components,
      // 99spokes components data for auto-creation
      spokesComponents,
    } = req.body as {
      age?: number;
      location?: string;
      bikeYear?: number;
      bikeMake?: string;
      bikeModel?: string;
      bikeTravelFork?: number;
      bikeTravelShock?: number;
      spokesId?: string;
      spokesUrl?: string;
      thumbnailUrl?: string;
      family?: string;
      category?: string;
      subcategory?: string;
      buildKind?: string;
      isFrameset?: boolean;
      isEbike?: boolean;
      gender?: string;
      frameMaterial?: string;
      hangerStandard?: string;
      motorMaker?: string;
      motorModel?: string;
      motorPowerW?: number;
      motorTorqueNm?: number;
      batteryWh?: number;
      components?: {
        fork?: string;
        rearShock?: string;
        wheels?: string;
        dropperPost?: string;
      };
      spokesComponents?: Record<string, { maker?: string; model?: string; description?: string; kind?: string } | null>;
    };

    // Validate bike data
    if (!bikeMake || !bikeModel) {
      return sendBadRequest(res, 'Bike make and model are required');
    }

    if (age && (age < 16 || age > 150)) {
      return sendBadRequest(res, 'Please enter a valid age');
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

      // Create bike with all metadata
      const bikeIsEbike = isEbike ?? false;
      const bike = await tx.bike.create({
        data: {
          userId,
          manufacturer: bikeMake,
          model: bikeModel,
          year: bikeYear || null,
          travelForkMm: bikeTravelFork || null,
          travelShockMm: bikeTravelShock || null,
          spokesId: spokesId || null,
          // 99spokes metadata
          spokesUrl: spokesUrl || null,
          thumbnailUrl: thumbnailUrl || null,
          family: family || null,
          category: category || null,
          subcategory: subcategory || null,
          buildKind: buildKind || null,
          isFrameset: isFrameset ?? false,
          isEbike: bikeIsEbike,
          gender: gender || null,
          frameMaterial: frameMaterial || null,
          hangerStandard: hangerStandard || null,
          // E-bike motor/battery specs (only store if e-bike)
          motorMaker: bikeIsEbike ? (motorMaker || null) : null,
          motorModel: bikeIsEbike ? (motorModel || null) : null,
          motorPowerW: bikeIsEbike && motorPowerW ? Math.max(0, Math.floor(motorPowerW)) : null,
          motorTorqueNm: bikeIsEbike && motorTorqueNm ? Math.max(0, Math.floor(motorTorqueNm)) : null,
          batteryWh: bikeIsEbike && batteryWh ? Math.max(0, Math.floor(batteryWh)) : null,
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

      // Auto-create components from 99spokes data
      if (spokesComponents) {
        const spokesToComponentType: Record<string, ComponentType> = {
          fork: 'FORK',
          rearShock: 'SHOCK',
          brakes: 'BRAKES',
          rearDerailleur: 'REAR_DERAILLEUR',
          crank: 'CRANK',
          cassette: 'CASSETTE',
          rims: 'RIMS',
          tires: 'TIRES',
          stem: 'STEM',
          handlebar: 'HANDLEBAR',
          saddle: 'SADDLE',
          seatpost: 'SEATPOST',
        };

        for (const [key, compData] of Object.entries(spokesComponents)) {
          if (!compData || !compData.maker || !compData.model) continue;

          let componentType = spokesToComponentType[key];
          if (!componentType) continue;

          // Smart dropper detection: if seatpost.kind === 'dropper', create as DROPPER
          if (key === 'seatpost' && compData.kind === 'dropper') {
            componentType = 'DROPPER';
          }

          // Skip types already handled above (FORK, SHOCK, WHEELS, DROPPER from legacy components)
          if (['FORK', 'SHOCK', 'WHEELS', 'PIVOT_BEARINGS'].includes(componentType)) continue;

          // Check if component already exists (important for DROPPER which may already exist)
          const existing = await tx.component.findFirst({
            where: { bikeId: bike.id, type: componentType },
          });

          if (!existing) {
            try {
              await tx.component.create({
                data: {
                  userId,
                  bikeId: bike.id,
                  type: componentType,
                  brand: compData.maker,
                  model: compData.model,
                  notes: compData.description ?? null,
                  isStock: true,
                  hoursUsed: 0,
                },
              });

              console.log(`[Onboarding] Created ${componentType} component from 99spokes for bike: ${bike.id}`);
            } catch (error) {
              // Handle race condition: component was created between findFirst and create
              if (error instanceof Error && error.message.includes('Unique constraint')) {
                continue;
              }
              throw error;
            }
          }
        }
      }

      return { user, bike };
    });

    res.status(200).json({
      ok: true,
      message: 'Onboarding completed successfully',
      bikeId: result.bike.id,
    });
  } catch (error) {
    console.error('[Onboarding] Error completing onboarding:', error);
    return sendInternalError(res, 'An error occurred while completing onboarding. Please try again.');
  }
});

export default router;
