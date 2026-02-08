import type { PrismaClient, Prisma } from '@prisma/client';
import { getSlotKey } from '@loam/shared';
import type {
  SetupSnapshot,
  BikeSpecsSnapshot,
  SlotSnapshot,
  ComponentSnapshot,
} from '@loam/shared';

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Capture an immutable snapshot of a bike's current setup.
 * Used for BikeNote records to preserve setup history.
 */
export async function captureSetupSnapshot(
  bikeId: string,
  tx: TransactionClient | Prisma.TransactionClient
): Promise<SetupSnapshot> {
  const client = tx as TransactionClient;

  // Fetch bike with all active installs
  const bike = await client.bike.findUniqueOrThrow({
    where: { id: bikeId },
    include: {
      installs: {
        where: { removedAt: null },
        include: {
          component: true,
        },
      },
    },
  });

  // Build bike specs snapshot
  const bikeSpecs: BikeSpecsSnapshot = {
    travelForkMm: bike.travelForkMm,
    travelShockMm: bike.travelShockMm,
    isEbike: bike.isEbike,
    batteryWh: bike.batteryWh,
    motorPowerW: bike.motorPowerW,
    motorTorqueNm: bike.motorTorqueNm,
    motorMaker: bike.motorMaker,
    motorModel: bike.motorModel,
  };

  // Map each active install to a slot snapshot
  const slots: SlotSnapshot[] = bike.installs.map((install) => {
    const component = install.component;
    const componentSnapshot: ComponentSnapshot | null = component
      ? {
          componentId: component.id,
          brand: component.brand,
          model: component.model,
          isStock: component.isStock,
          hoursUsed: component.hoursUsed,
          serviceDueAtHours: component.serviceDueAtHours,
          settings: [], // Future: extensible settings
        }
      : null;

    // Parse slot key to get type and location
    const slotKey = install.slotKey;
    const lastUnderscore = slotKey.lastIndexOf('_');
    const componentType = slotKey.substring(0, lastUnderscore);
    const location = slotKey.substring(lastUnderscore + 1);

    return {
      slotKey,
      componentType,
      location,
      component: componentSnapshot,
    };
  });

  // Sort slots by type then location for consistent ordering
  slots.sort((a, b) => {
    if (a.componentType !== b.componentType) {
      return a.componentType.localeCompare(b.componentType);
    }
    return a.location.localeCompare(b.location);
  });

  return {
    capturedAt: new Date().toISOString(),
    bikeSpecs,
    slots,
  };
}
