import express, { type Request } from 'express';
import { prisma } from '../lib/prisma';
import { type SessionUser } from '../auth/session';
import { type AcquisitionCondition } from '@prisma/client';
import { sendBadRequest, sendUnauthorized, sendInternalError } from '../lib/api-response';
import { deriveBikeSpec, type SpokesComponents } from '@loam/shared';
import { logError } from '../lib/logger';
import {
  buildBikeComponents,
  type BikeComponentInputGQL,
  type SpokesComponentsInputGQL,
  type BikeComponentKey,
} from '../graphql/resolvers';

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
      // Bike acquisition condition (new/used/mixed)
      acquisitionCondition,
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
      // Component overrides (new format matching BikeForm)
      components?: Partial<Record<BikeComponentKey, BikeComponentInputGQL | null>>;
      spokesComponents?: SpokesComponentsInputGQL;
      acquisitionCondition?: AcquisitionCondition;
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

      // Derive BikeSpec from travel values and 99spokes component data
      // This detects suspension from either travel values OR component presence
      const bikeSpec = deriveBikeSpec(
        { travelForkMm: bikeTravelFork, travelShockMm: bikeTravelShock },
        spokesComponents as SpokesComponents | undefined
      );

      // Create all applicable components using the same logic as My Bikes
      await buildBikeComponents(tx, {
        bikeId: bike.id,
        userId,
        bikeSpec,
        acquisitionCondition: acquisitionCondition ?? 'NEW',
        spokesComponents: spokesComponents ?? null,
        userOverrides: components ?? undefined,
      });

      console.log(`[Onboarding] Created components for bike: ${bike.id}`);

      return { user, bike };
    });

    res.status(200).json({
      ok: true,
      message: 'Onboarding completed successfully',
      bikeId: result.bike.id,
    });
  } catch (error) {
    logError('Onboarding', error);
    return sendInternalError(res, 'An error occurred while completing onboarding. Please try again.');
  }
});

export default router;
