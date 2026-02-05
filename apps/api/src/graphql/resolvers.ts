import { GraphQLError } from 'graphql';
import type { GraphQLContext } from '../server';
import { prisma } from '../lib/prisma';
import { ComponentType as ComponentTypeEnum } from '@prisma/client';
import type {
  Prisma,
  ComponentType as ComponentTypeLiteral,
  ComponentLocation,
  Bike,
  Component as ComponentModel,
} from '@prisma/client';
import { checkRateLimit, checkMutationRateLimit, checkQueryRateLimit } from '../lib/rate-limit';
import { enqueueSyncJob, type SyncProvider } from '../lib/queue';
import { invalidateBikePrediction } from '../services/prediction/cache';
import { getBaseInterval, BASE_INTERVALS_HOURS, DEFAULT_INTERVAL_HOURS } from '../services/prediction/config';
import {
  getApplicableComponents,
  deriveBikeSpec,
  requiresPairing,
  getSlotKey,
  parseSlotKey,
  type BikeSpec,
  type SpokesComponents,
  CURRENT_TERMS_VERSION,
  COMPONENT_CATALOG,
} from '@loam/shared';
import { createId } from '@paralleldrive/cuid2';
import { logError } from '../lib/logger';
import { config } from '../config/env';
import type { AcquisitionCondition, BaselineMethod, BaselineConfidence } from '@prisma/client';
import { getBikeById, isSpokesConfigured } from '../services/spokes';
import { parseISO } from 'date-fns';
import { incrementBikeComponentHours, decrementBikeComponentHours } from '../lib/component-hours';

type ComponentType = ComponentTypeLiteral;

type UserArgs = { id: string };

type AddRideInput = {
  startTime: string;
  durationSeconds: number;
  distanceMiles: number;
  elevationGainFeet: number;
  averageHr?: number | null;
  rideType: string;
  bikeId?: string | null;
  notes?: string | null;
  trailSystem?: string | null;
  location?: string | null;
};

type UpdateRideInput = {
  startTime?: string | null;
  durationSeconds?: number | null;
  distanceMiles?: number | null;
  elevationGainFeet?: number | null;
  averageHr?: number | null;
  rideType?: string | null;
  bikeId?: string | null;
  notes?: string | null;
  trailSystem?: string | null;
  location?: string | null;
};

export type BikeComponentInputGQL = {
  brand?: string | null;
  model?: string | null;
  notes?: string | null;
  isStock?: boolean | null;
};

type SpokesComponentInputGQL = {
  maker?: string | null;
  model?: string | null;
  description?: string | null;
  kind?: string | null;  // For seatpost: 'dropper' | 'rigid'
};

export type SpokesComponentsInputGQL = {
  fork?: SpokesComponentInputGQL | null;
  rearShock?: SpokesComponentInputGQL | null;
  brakes?: SpokesComponentInputGQL | null;
  rearDerailleur?: SpokesComponentInputGQL | null;
  crank?: SpokesComponentInputGQL | null;
  cassette?: SpokesComponentInputGQL | null;
  rims?: SpokesComponentInputGQL | null;
  tires?: SpokesComponentInputGQL | null;
  stem?: SpokesComponentInputGQL | null;
  handlebar?: SpokesComponentInputGQL | null;
  saddle?: SpokesComponentInputGQL | null;
  seatpost?: SpokesComponentInputGQL | null;
};

// Paired component configuration for front/rear differentiation
type PairedComponentSpecInputGQL = {
  brand: string;
  model: string;
};

export type PairedComponentConfigInputGQL = {
  type: ComponentType;
  useSameSpec: boolean;
  frontSpec?: PairedComponentSpecInputGQL | null;
  rearSpec?: PairedComponentSpecInputGQL | null;
};

type ReplaceComponentInputGQL = {
  componentId: string;
  newBrand: string;
  newModel: string;
  alsoReplacePair?: boolean | null;
  pairBrand?: string | null;
  pairModel?: string | null;
};

type NewComponentInputGQL = {
  brand: string;
  model: string;
  isStock?: boolean | null;
};

type InstallComponentInputGQL = {
  bikeId: string;
  slotKey: string;
  existingComponentId?: string | null;
  newComponent?: NewComponentInputGQL | null;
  alsoReplacePair?: boolean | null;
  pairNewComponent?: NewComponentInputGQL | null;
};

type SwapComponentsInputGQL = {
  bikeIdA: string;
  slotKeyA: string;
  bikeIdB: string;
  slotKeyB: string;
};

type AddBikeInputGQL = {
  nickname?: string | null;
  manufacturer: string;
  model: string;
  year: number;
  travelForkMm?: number | null;
  travelShockMm?: number | null;
  notes?: string | null;
  spokesId?: string | null;
  spokesUrl?: string | null;
  thumbnailUrl?: string | null;
  family?: string | null;
  category?: string | null;
  subcategory?: string | null;
  buildKind?: string | null;
  isFrameset?: boolean | null;
  isEbike?: boolean | null;
  gender?: string | null;
  frameMaterial?: string | null;
  hangerStandard?: string | null;
  // E-bike motor/battery specs
  motorMaker?: string | null;
  motorModel?: string | null;
  motorPowerW?: number | null;
  motorTorqueNm?: number | null;
  batteryWh?: number | null;
  acquisitionCondition?: AcquisitionCondition | null;
  spokesComponents?: SpokesComponentsInputGQL | null;
  fork?: BikeComponentInputGQL | null;
  shock?: BikeComponentInputGQL | null;
  seatpost?: BikeComponentInputGQL | null;
  wheels?: BikeComponentInputGQL | null;
  pivotBearings?: BikeComponentInputGQL | null;
  pairedComponentConfigs?: PairedComponentConfigInputGQL[] | null;
};

type ComponentBaselineInputGQL = {
  componentId: string;
  wearPercent: number;
  method: BaselineMethod;
  lastServicedAt?: string | null;
};

type BulkUpdateBaselinesInputGQL = {
  updates: ComponentBaselineInputGQL[];
};

type UpdateBikeInputGQL = Partial<AddBikeInputGQL> & {
  year?: number | null;
};

type AddComponentInputGQL = {
  type: ComponentType;
  location?: ComponentLocation | null;
  brand?: string | null;
  model?: string | null;
  notes?: string | null;
  isStock?: boolean | null;
  hoursUsed?: number | null;
  serviceDueAtHours?: number | null;
};

type UpdateComponentInputGQL = {
  location?: ComponentLocation | null;
  brand?: string | null;
  model?: string | null;
  notes?: string | null;
  isStock?: boolean | null;
  hoursUsed?: number | null;
  serviceDueAtHours?: number | null;
};

type ComponentFilterInputGQL = {
  bikeId?: string | null;
  onlySpare?: boolean | null;
  types?: Array<ComponentType> | null;
};

type ComponentFilterArgs = { filter?: ComponentFilterInputGQL | null };

function parseIso(value: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid startTime; must be ISO 8601');
  return d;
}

/** If v is undefined => leave unchanged; if null => ignore (do not update); else parse. */
function parseIsoOptionalStrict(v: string | null | undefined): Date | undefined {
  if (v == null) return undefined; // undefined means: do not include in update
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid startTime; must be ISO 8601');
  return d;
}

const MAX_NOTES_LEN = 2000;

const MAX_LABEL_LEN = 120;

/**
 * Clean user input text.
 * - Trims whitespace
 * - Truncates to max length
 *
 * Note: XSS prevention is handled at the rendering layer (frontend),
 * not at the storage layer. HTML escaping here would cause double-encoding
 * and data corruption issues.
 */
const cleanText = (v: unknown, max = MAX_LABEL_LEN) =>
  typeof v === 'string' ? (v.trim().slice(0, max) || null) : null;

const componentLabelMap: Partial<Record<ComponentType, string>> = {
  FORK: 'Fork',
  SHOCK: 'Shock',
  DROPPER: 'Dropper Post',
  WHEEL_HUBS: 'Wheel Hubs',
  PIVOT_BEARINGS: 'Pivot Bearings',
};

const REQUIRED_BIKE_COMPONENTS = [
  ['fork', ComponentTypeEnum.FORK],
  ['shock', ComponentTypeEnum.SHOCK],
  ['seatpost', ComponentTypeEnum.SEATPOST],
  ['wheels', ComponentTypeEnum.WHEEL_HUBS],
  ['pivotBearings', ComponentTypeEnum.PIVOT_BEARINGS],
] as const;

export type BikeComponentKey = (typeof REQUIRED_BIKE_COMPONENTS)[number][0];

const nowIsoYear = () => new Date().getFullYear();

const clampYear = (value: number | null | undefined) => {
  if (value == null || Number.isNaN(value)) return nowIsoYear();
  const yr = Math.floor(value);
  return Math.min(nowIsoYear() + 1, Math.max(1980, yr));
};

const parseTravel = (value: number | null | undefined) =>
  value == null || Number.isNaN(value) ? undefined : Math.max(0, Math.floor(value));

const componentLabel = (type: ComponentType) =>
  componentLabelMap[type] ?? type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const requireUserId = (ctx: GraphQLContext) => {
  const id = ctx.user?.id;
  if (!id) throw new Error('Unauthorized');
  return id;
};

/**
 * Validate service preference inputs.
 * Throws GraphQLError if component type is invalid or custom interval is out of range.
 */
const validateServicePreferences = (
  preferences: Array<{ componentType: ComponentTypeLiteral; customInterval?: number | null }>
) => {
  const validComponentTypes = Object.values(ComponentTypeEnum);
  for (const pref of preferences) {
    if (!validComponentTypes.includes(pref.componentType as ComponentTypeEnum)) {
      throw new GraphQLError(`Invalid component type: ${pref.componentType}`, {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }
    if (pref.customInterval !== null && pref.customInterval !== undefined) {
      if (pref.customInterval <= 0 || pref.customInterval > 1000) {
        throw new GraphQLError(`Invalid custom interval for ${pref.componentType}. Must be between 1 and 1000 hours.`, {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }
    }
  }
};

const normalizeBikeComponentInput = (
  type: ComponentType,
  input?: BikeComponentInputGQL | null
) => {
  const fallback = componentLabel(type);
  const brand =
    input && input.brand !== undefined ? cleanText(input.brand, MAX_LABEL_LEN) : undefined;
  const model =
    input && input.model !== undefined ? cleanText(input.model, MAX_LABEL_LEN) : undefined;
  const notes =
    input && input.notes !== undefined ? cleanText(input.notes, MAX_NOTES_LEN) : null;
  const inferredStock = !brand && !model;
  const isStock = input?.isStock ?? inferredStock ?? false;

  return {
    brand: brand ?? (isStock ? 'Stock' : fallback),
    model: model ?? (isStock ? 'Stock' : fallback),
    notes,
    isStock,
  };
};

/**
 * Extract brand/model from 99Spokes component data.
 * Handles various data availability scenarios with centralized fallback logic.
 *
 * @param spokesData - Component data from 99Spokes API
 * @param fallbackModel - Fallback model name (e.g., component display name)
 * @returns Extracted component data or null if no usable data
 */
const extractSpokesComponentData = (
  spokesData: SpokesComponentInputGQL | undefined,
  fallbackModel: string
): { brand: string; model: string; notes: string | null } | null => {
  if (!spokesData) return null;

  // Case 1: Both maker and model available (best case)
  if (spokesData.maker && spokesData.model) {
    return {
      brand: spokesData.maker,
      model: spokesData.model,
      notes: spokesData.description ?? null,
    };
  }

  // Case 2: Maker available with description (use description as model)
  if (spokesData.maker && spokesData.description) {
    return {
      brand: spokesData.maker,
      model: spokesData.description,
      notes: null,
    };
  }

  // Case 3: Only description available (parse first word as brand)
  if (spokesData.description) {
    const parts = spokesData.description.trim().split(/\s+/).filter(Boolean);
    if (parts.length > 1) {
      return {
        brand: parts[0],
        model: parts.slice(1).join(' '),
        notes: null,
      };
    }
    if (parts.length === 1) {
      return {
        brand: parts[0],
        model: fallbackModel,
        notes: null,
      };
    }
  }

  return null;
};

/**
 * Check if user override contains actual component data.
 * An override is considered "real" if it has brand, model, or explicitly marks as non-stock.
 */
const hasUserOverride = (override: BikeComponentInputGQL | undefined): boolean => {
  if (!override) return false;
  // User provided brand or model data
  if (override.brand || override.model) return true;
  // User explicitly marked as non-stock (aftermarket component)
  if (override.isStock === false) return true;
  return false;
};

async function syncBikeComponents(
  tx: Prisma.TransactionClient,
  opts: {
    bikeId: string;
    userId: string;
    components?: Partial<Record<BikeComponentKey, BikeComponentInputGQL | null>>;
    createMissing: boolean;
  }
) {
  for (const [key, type] of REQUIRED_BIKE_COMPONENTS) {
    const incoming = opts.components?.[key];
    if (!incoming && !opts.createMissing) continue;

    const normalized = normalizeBikeComponentInput(type, incoming);
    const existing = await tx.component.findFirst({
      where: { bikeId: opts.bikeId, type },
    });

    if (existing) {
      if (!incoming && !opts.createMissing) continue;
      await tx.component.update({
        where: { id: existing.id },
        data: {
          brand: normalized.brand,
          model: normalized.model,
          notes: normalized.notes,
          isStock: normalized.isStock,
        },
      });
    } else if (opts.createMissing || incoming) {
      try {
        await tx.component.create({
          data: {
            type,
            bikeId: opts.bikeId,
            userId: opts.userId,
            brand: normalized.brand,
            model: normalized.model,
            notes: normalized.notes,
            isStock: normalized.isStock,
            installedAt: new Date(),
          },
        });
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

/**
 * Build bike components dynamically based on BikeSpec and component catalog.
 * This replaces the old syncBikeComponents for new bike creation with baseline support.
 */
export async function buildBikeComponents(
  tx: Prisma.TransactionClient,
  opts: {
    bikeId: string;
    userId: string;
    bikeSpec: BikeSpec;
    spokesComponents?: SpokesComponentsInputGQL | null;
    userOverrides?: Partial<Record<BikeComponentKey, BikeComponentInputGQL | null>>;
    pairedComponentConfigs?: PairedComponentConfigInputGQL[] | null;
  }
): Promise<void> {
  const { bikeId, userId, bikeSpec, spokesComponents, userOverrides, pairedComponentConfigs } = opts;

  // Build a map of paired component configs by type for easy lookup
  const pairedConfigsByType: Map<string, PairedComponentConfigInputGQL> = new Map();
  if (pairedComponentConfigs) {
    for (const config of pairedComponentConfigs) {
      pairedConfigsByType.set(config.type, config);
    }
  }

  // Always start at 0% baseline - ride backfill + service dates provide accuracy
  const baselineWearPercent = 0;
  const baselineMethod: BaselineMethod = 'DEFAULT';
  const baselineConfidence: BaselineConfidence = 'LOW';  // Until refined by user
  const baselineSetAt = new Date();

  // Get applicable components from the catalog
  const applicableComponents = getApplicableComponents(bikeSpec);

  // Build a map of spokes data for easy lookup
  const spokesMap: Record<string, SpokesComponentInputGQL> = {};
  if (spokesComponents) {
    for (const [key, data] of Object.entries(spokesComponents)) {
      if (data) {
        spokesMap[key] = data;
      }
    }
  }

  // Map user overrides by component type
  const overridesByType: Record<string, BikeComponentInputGQL> = {};
  if (userOverrides) {
    for (const [key, data] of Object.entries(userOverrides)) {
      if (data) {
        const typeMap: Record<string, string> = {
          fork: 'FORK',
          shock: 'SHOCK',
          seatpost: 'SEATPOST',
          wheels: 'WHEEL_HUBS',
          pivotBearings: 'PIVOT_BEARINGS',
        };
        const componentType = typeMap[key];
        if (componentType) {
          overridesByType[componentType] = data;
        }
      }
    }
  }

  // Build component data for batch creation
  const componentsToCreate: Prisma.ComponentCreateManyInput[] = [];

  for (const componentDef of applicableComponents) {
    const { type, spokesKey, displayName } = componentDef;

    // Check for user override first
    const override = overridesByType[type];

    // Get spokes data if available
    let spokesData: SpokesComponentInputGQL | undefined;
    if (spokesKey) {
      spokesData = spokesMap[spokesKey];
      // Handle seatpost/dropper special case
      if (spokesKey === 'seatpost' && spokesData?.kind === 'dropper' && type === 'SEATPOST') {
        // This is actually a dropper, skip SEATPOST creation
        continue;
      }
    }

    // Determine brand/model/notes/isStock
    let brand: string;
    let model: string;
    let notes: string | null = null;
    let isStock = true;

    if (hasUserOverride(override)) {
      // User provided real component data (brand, model, or explicitly non-stock)
      const normalized = normalizeBikeComponentInput(type as ComponentType, override);
      brand = normalized.brand;
      model = normalized.model;
      notes = normalized.notes;
      isStock = normalized.isStock;
    } else {
      // Try to extract from 99Spokes data, fall back to stock component
      const spokesExtracted = extractSpokesComponentData(spokesData, displayName);
      if (spokesExtracted) {
        brand = spokesExtracted.brand;
        model = spokesExtracted.model;
        notes = spokesExtracted.notes;
        isStock = true;
      } else {
        // Default stock component
        brand = 'Stock';
        model = displayName;
        isStock = true;
      }
    }

    // Check if this component type requires front/rear pairing
    if (requiresPairing(type)) {
      const pairGroupId = createId();
      const pairedConfig = pairedConfigsByType.get(type);

      // Determine front and rear specs
      let frontBrand = brand;
      let frontModel = model;
      let rearBrand = brand;
      let rearModel = model;

      if (pairedConfig) {
        if (!pairedConfig.useSameSpec) {
          // User wants different specs for front and rear
          if (pairedConfig.frontSpec) {
            frontBrand = pairedConfig.frontSpec.brand;
            frontModel = pairedConfig.frontSpec.model;
          }
          if (pairedConfig.rearSpec) {
            rearBrand = pairedConfig.rearSpec.brand;
            rearModel = pairedConfig.rearSpec.model;
          }
        }
        // If useSameSpec is true, use the same brand/model for both (already set)
      }

      // Create FRONT component
      componentsToCreate.push({
        type: type as ComponentType,
        location: 'FRONT' as ComponentLocation,
        bikeId,
        userId,
        brand: frontBrand,
        model: frontModel,
        notes,
        isStock,
        hoursUsed: 0,
        installedAt: baselineSetAt,
        baselineWearPercent,
        baselineMethod,
        baselineConfidence,
        baselineSetAt,
        pairGroupId,
      });

      // Create REAR component
      componentsToCreate.push({
        type: type as ComponentType,
        location: 'REAR' as ComponentLocation,
        bikeId,
        userId,
        brand: rearBrand,
        model: rearModel,
        notes,
        isStock,
        hoursUsed: 0,
        installedAt: baselineSetAt,
        baselineWearPercent,
        baselineMethod,
        baselineConfidence,
        baselineSetAt,
        pairGroupId,
      });
    } else {
      // Non-paired component - create single instance
      componentsToCreate.push({
        type: type as ComponentType,
        bikeId,
        userId,
        brand,
        model,
        notes,
        isStock,
        hoursUsed: 0,
        installedAt: baselineSetAt,
        baselineWearPercent,
        baselineMethod,
        baselineConfidence,
        baselineSetAt,
      });
    }
  }

  // Batch create all components
  // skipDuplicates handles race conditions where components may already exist
  if (componentsToCreate.length > 0) {
    await tx.component.createMany({
      data: componentsToCreate,
      skipDuplicates: true,
    });

    // Create BikeComponentInstall records for all newly created components
    const createdComponents = await tx.component.findMany({
      where: { bikeId, userId, retiredAt: null },
      select: { id: true, type: true, location: true, installedAt: true, createdAt: true },
    });
    if (createdComponents.length > 0) {
      await tx.bikeComponentInstall.createMany({
        data: createdComponents.map((c) => ({
          userId,
          bikeId,
          componentId: c.id,
          slotKey: getSlotKey(c.type, c.location),
          installedAt: c.installedAt ?? c.createdAt,
        })),
        skipDuplicates: true,
      });
    }
  }
}

const normalizeLooseComponentInput = (
  type: ComponentType,
  input: UpdateComponentInputGQL | AddComponentInputGQL,
  base?: {
    brand: string;
    model: string;
    notes: string | null;
    isStock: boolean;
    hoursUsed: number;
    serviceDueAtHours: number | null;
  }
) => {
  const fallback = componentLabel(type);
  const defaults: {
    brand: string;
    model: string;
    notes: string | null;
    isStock: boolean;
    hoursUsed: number;
    serviceDueAtHours: number | null;
  } =
    base ??
    {
      brand: fallback,
      model: fallback,
      notes: null,
      isStock: Boolean(input.isStock ?? true),
      hoursUsed: 0,
      serviceDueAtHours: null,
    };

  const brand =
    input.brand !== undefined ? cleanText(input.brand, MAX_LABEL_LEN) ?? 'Stock' : undefined;
  const model =
    input.model !== undefined ? cleanText(input.model, MAX_LABEL_LEN) ?? 'Stock' : undefined;
  const notes =
    input.notes !== undefined ? cleanText(input.notes, MAX_NOTES_LEN) : undefined;
  const isStock =
    input.isStock !== undefined ? Boolean(input.isStock) : defaults.isStock ?? false;
  const hoursUsed =
    input.hoursUsed !== undefined
      ? Math.max(0, Number(input.hoursUsed ?? 0))
      : defaults.hoursUsed ?? 0;
  const serviceDueAtHours =
    input.serviceDueAtHours !== undefined
      ? input.serviceDueAtHours == null
        ? null
        : Math.max(0, Number(input.serviceDueAtHours))
      : defaults.serviceDueAtHours ?? null;

  return {
    brand: brand ?? defaults.brand ?? fallback,
    model: model ?? defaults.model ?? fallback,
    notes: notes !== undefined ? notes : defaults.notes ?? null,
    isStock,
    hoursUsed,
    serviceDueAtHours,
  };
};

// Runtime list (must match your Prisma enum names exactly)
const ALLOWED_RIDE_TYPES = [
  'TRAIL',
  'ENDURO',
  'COMMUTE',
  'ROAD',
  'GRAVEL',
  'TRAINER',
] as const;

type RidesFilterInput = {
  startDate?: string | null;
  endDate?: string | null;
  bikeId?: string | null;
};

type RidesArgs = {
  take?: number;
  after?: string | null;
  filter?: RidesFilterInput | null;
};

const pickComponent = (
  bike: Bike & { components?: ComponentModel[] },
  type: ComponentType
) => {
  if (bike.components) return bike.components.find((c) => c.type === type) ?? null;
  return prisma.component.findFirst({ where: { bikeId: bike.id, type } });
};

export const resolvers = {
  Query: {
    user: (args: UserArgs) =>
      prisma.user.findUnique({
        where: { id: args.id },
        include: { rides: true },
      }),

    rides: async (_: unknown, { take = 1000, after, filter }: RidesArgs, ctx: GraphQLContext) => {
      if (!ctx.user?.id) throw new Error('Unauthorized');
      const limit = Math.min(10000, Math.max(1, take));

      const whereClause: Prisma.RideWhereInput = {
        userId: ctx.user.id,
      };

      // Apply date filters if provided
      if (filter?.startDate || filter?.endDate) {
        whereClause.startTime = {};
        if (filter.startDate) {
          whereClause.startTime.gte = new Date(filter.startDate);
        }
        if (filter.endDate) {
          whereClause.startTime.lte = new Date(filter.endDate);
        }
      }

      // Apply bike filter if provided
      if (filter?.bikeId) {
        // Verify bike belongs to user to prevent unauthorized data access
        const bike = await prisma.bike.findUnique({
          where: { id: filter.bikeId },
          select: { userId: true },
        });

        if (!bike || bike.userId !== ctx.user.id) {
          throw new GraphQLError('Bike not found', {
            extensions: { code: 'NOT_FOUND' },
          });
        }

        whereClause.bikeId = filter.bikeId;
      }

      return prisma.ride.findMany({
        where: whereClause,
        orderBy: { startTime: 'desc' },
        take: limit,
        ...(after ? { skip: 1, cursor: { id: after } } : {}),
      });
    },

    rideTypes: () => ALLOWED_RIDE_TYPES,

    me: async (_: unknown, _args: unknown, ctx: GraphQLContext) => {
      const id = ctx.user?.id;
      return id ? prisma.user.findUnique({ where: { id } }) : null;
    },

    bikes: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
      const userId = requireUserId(ctx);
      return prisma.bike.findMany({
        where: { userId },
        orderBy: { sortOrder: 'asc' },
        include: { components: true },
      });
    },

    components: async (_: unknown, args: ComponentFilterArgs, ctx: GraphQLContext) => {
      const userId = requireUserId(ctx);
      const filter = args.filter ?? {};
      const where: Prisma.ComponentWhereInput = { userId };

      if (filter.bikeId) {
        where.bikeId = filter.bikeId;
      } else if (filter.onlySpare) {
        where.bikeId = null;
      }

      if (filter.types?.length) {
        where.type = { in: filter.types as ComponentTypeLiteral[] };
      }

      return prisma.component.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });
    },

    stravaGearMappings: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
      const userId = requireUserId(ctx);
      return prisma.stravaGearMapping.findMany({
        where: { userId },
        include: { bike: true },
        orderBy: { createdAt: 'desc' },
      });
    },

    unmappedStravaGears: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
      const userId = requireUserId(ctx);

      const rides = await prisma.ride.findMany({
        where: { userId, stravaGearId: { not: null } },
        select: { stravaGearId: true },
      });

      const gearCounts = new Map<string, number>();
      rides.forEach((ride) => {
        if (ride.stravaGearId) {
          gearCounts.set(ride.stravaGearId, (gearCounts.get(ride.stravaGearId) || 0) + 1);
        }
      });

      const mappings = await prisma.stravaGearMapping.findMany({
        where: { userId },
        select: { stravaGearId: true },
      });
      const mappedGearIds = new Set(mappings.map((m) => m.stravaGearId));

      const result: Array<{
        gearId: string;
        gearName: string | null;
        rideCount: number;
        isMapped: boolean;
      }> = [];

      gearCounts.forEach((count, gearId) => {
        result.push({
          gearId,
          gearName: null,
          rideCount: count,
          isMapped: mappedGearIds.has(gearId),
        });
      });

      return result.filter((g) => !g.isMapped);
    },

    importNotificationState: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
      const userId = ctx.user?.id;
      if (!userId) {
        return {
          showOverlay: false,
          sessionId: null,
          unassignedRideCount: 0,
          totalImportedCount: 0,
        };
      }

      // Rate limit check for polling queries
      const rateLimit = await checkQueryRateLimit('importNotificationState', userId);
      if (!rateLimit.allowed) {
        throw new GraphQLError(`Rate limit exceeded. Try again in ${rateLimit.retryAfter} seconds.`, {
          extensions: { code: 'RATE_LIMITED', retryAfter: rateLimit.retryAfter },
        });
      }

      // Find most recent completed, unacknowledged session with unassigned rides
      const session = await prisma.importSession.findFirst({
        where: {
          userId,
          status: 'completed',
          userAcknowledgedAt: null,
          unassignedRideCount: { gt: 0 },
        },
        orderBy: { completedAt: 'desc' },
        select: {
          id: true,
          unassignedRideCount: true,
          _count: {
            select: { rides: true },
          },
        },
      });

      if (!session) {
        return {
          showOverlay: false,
          sessionId: null,
          unassignedRideCount: 0,
          totalImportedCount: 0,
        };
      }

      // Get current unassigned count (may have changed since session completed)
      const currentUnassignedCount = await prisma.ride.count({
        where: { importSessionId: session.id, bikeId: null },
      });

      return {
        showOverlay: currentUnassignedCount > 0,
        sessionId: session.id,
        unassignedRideCount: currentUnassignedCount,
        totalImportedCount: session._count.rides,
      };
    },

    unassignedRides: async (
      _: unknown,
      { importSessionId, take = 50, after }: { importSessionId: string; take?: number; after?: string | null },
      ctx: GraphQLContext
    ) => {
      const userId = requireUserId(ctx);

      // Rate limit check for polling queries
      const rateLimit = await checkQueryRateLimit('unassignedRides', userId);
      if (!rateLimit.allowed) {
        throw new GraphQLError(`Rate limit exceeded. Try again in ${rateLimit.retryAfter} seconds.`, {
          extensions: { code: 'RATE_LIMITED', retryAfter: rateLimit.retryAfter },
        });
      }

      // Verify the session belongs to the user
      const session = await prisma.importSession.findUnique({
        where: { id: importSessionId },
        select: { userId: true },
      });

      if (!session || session.userId !== userId) {
        throw new Error('Import session not found');
      }

      const limit = Math.min(100, Math.max(1, take));

      const [rides, totalCount] = await Promise.all([
        prisma.ride.findMany({
          where: { importSessionId, bikeId: null },
          orderBy: { startTime: 'desc' },
          take: limit + 1, // Fetch one extra to check if there's more
          ...(after ? { skip: 1, cursor: { id: after } } : {}),
          select: {
            id: true,
            startTime: true,
            durationSeconds: true,
            distanceMiles: true,
            elevationGainFeet: true,
            location: true,
            rideType: true,
          },
        }),
        prisma.ride.count({ where: { importSessionId, bikeId: null } }),
      ]);

      const hasMore = rides.length > limit;
      const resultRides = hasMore ? rides.slice(0, -1) : rides;

      return {
        rides: resultRides.map((r) => ({
          ...r,
          startTime: r.startTime.toISOString(),
        })),
        totalCount,
        hasMore,
      };
    },

    calibrationState: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
      const userId = ctx.user?.id;
      if (!userId) {
        return {
          showOverlay: false,
          overdueCount: 0,
          totalComponentCount: 0,
          bikes: [],
        };
      }

      // Get user calibration state
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          onboardingCompleted: true,
          calibrationCompletedAt: true,
          calibrationDismissedAt: true,
          role: true,
          predictionMode: true,
        },
      });

      if (!user) {
        return {
          showOverlay: false,
          overdueCount: 0,
          totalComponentCount: 0,
          bikes: [],
        };
      }

      // Get bikes with predictions to determine overdue components
      const bikes = await prisma.bike.findMany({
        where: { userId },
        orderBy: { sortOrder: 'asc' },
        include: { components: true },
      });

      if (bikes.length === 0) {
        return {
          showOverlay: false,
          overdueCount: 0,
          totalComponentCount: 0,
          bikes: [],
        };
      }

      // Generate predictions for each bike to get component status
      const { generateBikePredictions } = await import('../services/prediction');
      const predictionMode = (user.predictionMode === 'predictive' ? 'predictive' : 'simple') as 'simple' | 'predictive';
      const bikesWithPredictions = await Promise.all(
        bikes.map(async (bike) => {
          try {
            const predictions = await generateBikePredictions({
              userId,
              bikeId: bike.id,
              userRole: user.role,
              predictionMode,
            });
            return { bike, predictions };
          } catch {
            return { bike, predictions: null };
          }
        })
      );

      // Filter to bikes with overdue/due-now components
      const bikesNeedingCalibration: Array<{
        bikeId: string;
        bikeName: string;
        thumbnailUrl: string | null;
        components: Array<{
          componentId: string;
          componentType: string;
          location: string;
          brand: string;
          model: string;
          status: string;
          hoursRemaining: number;
          ridesRemainingEstimate: number;
          confidence: string;
          currentHours: number;
          serviceIntervalHours: number;
          hoursSinceService: number;
          why: string | null;
          drivers: Array<{ factor: string; contribution: number; label: string }> | null;
        }>;
      }> = [];

      let totalOverdue = 0;
      let totalComponents = 0;

      for (const { bike, predictions } of bikesWithPredictions) {
        if (!predictions?.components) continue;

        totalComponents += predictions.components.length;

        // Filter to OVERDUE and DUE_NOW components
        const needsAttention = predictions.components.filter(
          (c) => c.status === 'OVERDUE' || c.status === 'DUE_NOW'
        );

        if (needsAttention.length > 0) {
          totalOverdue += needsAttention.length;
          bikesNeedingCalibration.push({
            bikeId: bike.id,
            bikeName: bike.nickname || `${bike.year || ''} ${bike.manufacturer} ${bike.model}`.trim(),
            thumbnailUrl: bike.thumbnailUrl,
            components: needsAttention,
          });
        }
      }

      // Determine if overlay should show
      const showOverlay =
        user.onboardingCompleted &&
        !user.calibrationCompletedAt &&
        !user.calibrationDismissedAt &&
        totalOverdue > 0;

      return {
        showOverlay,
        overdueCount: totalOverdue,
        totalComponentCount: totalComponents,
        bikes: bikesNeedingCalibration,
      };
    },

    servicePreferenceDefaults: () => {
      // Get all trackable component types with their default intervals
      // Use COMPONENT_CATALOG for display names and BASE_INTERVALS_HOURS for intervals
      const trackableTypes = Object.keys(BASE_INTERVALS_HOURS) as ComponentTypeLiteral[];

      return trackableTypes.map((componentType) => {
        const interval = BASE_INTERVALS_HOURS[componentType];
        const catalogEntry = COMPONENT_CATALOG.find(c => c.type === componentType);
        const displayName = catalogEntry?.displayName ?? componentType.replace(/_/g, ' ');

        if (typeof interval === 'object') {
          // Location-based interval (has front/rear)
          return {
            componentType,
            displayName,
            defaultInterval: interval.front, // Use front as the "main" interval
            defaultIntervalFront: interval.front,
            defaultIntervalRear: interval.rear,
          };
        } else {
          // Single interval value
          return {
            componentType,
            displayName,
            defaultInterval: interval ?? DEFAULT_INTERVAL_HOURS,
            defaultIntervalFront: null,
            defaultIntervalRear: null,
          };
        }
      });
    },
  },
  Mutation: {
    addRide: async (_p: unknown, { input }: { input: AddRideInput }, ctx: GraphQLContext) => {
      if (!ctx.user?.id) throw new Error('Unauthorized');
      const userId = ctx.user.id;

      // Rate limit check
      const rateLimit = await checkMutationRateLimit('addRide', userId);
      if (!rateLimit.allowed) {
        throw new GraphQLError(`Rate limit exceeded. Try again in ${rateLimit.retryAfter} seconds.`, {
          extensions: { code: 'RATE_LIMITED', retryAfter: rateLimit.retryAfter },
        });
      }
      const start = parseIso(input.startTime);
      const durationSeconds = Math.max(0, Math.floor(input.durationSeconds));
      const distanceMiles = Math.max(0, Number(input.distanceMiles));
      const elevationGainFeet = Math.max(0, Number(input.elevationGainFeet));
      const averageHr =
        typeof input.averageHr === 'number' ? Math.max(0, Math.floor(input.averageHr)) : null;
      const notes = cleanText(input.notes, MAX_NOTES_LEN);
      const trailSystem = cleanText(input.trailSystem, MAX_LABEL_LEN);
      const location = cleanText(input.location, MAX_LABEL_LEN);
      const rideType = cleanText(input.rideType, 32); // required; validated below
      const requestedBikeId = input.bikeId ?? null;

      if (!rideType) throw new Error('rideType is required');

      let bikeId: string | null = null;
      if (requestedBikeId) {
        const ownedBike = await prisma.bike.findUnique({
          where: { id: requestedBikeId },
          select: { userId: true },
        });
        if (!ownedBike || ownedBike.userId !== userId) throw new Error('Bike not found');
        bikeId = requestedBikeId;
      } else {
        // If no bike specified, auto-assign if user has exactly one bike
        const userBikes = await prisma.bike.findMany({
          where: { userId },
          select: { id: true },
        });
        if (userBikes.length === 1) {
          bikeId = userBikes[0].id;
        }
      }

      const rideData: Prisma.RideUncheckedCreateInput = {
        userId,
        startTime: start,
        durationSeconds,
        distanceMiles,
        elevationGainFeet,
        averageHr,
        rideType,
        ...(bikeId ? { bikeId } : {}),
        ...(notes ? { notes } : {}),
        ...(trailSystem ? { trailSystem } : {}),
        ...(location ? { location } : {}),
      };

      const hoursDelta = durationSeconds / 3600;

      // Invalidate prediction cache BEFORE transaction to prevent stale reads
      if (bikeId) {
        await invalidateBikePrediction(userId, bikeId);
      }

      const ride = await prisma.$transaction(async (tx) => {
        const newRide = await tx.ride.create({ data: rideData });
        if (bikeId) {
          await incrementBikeComponentHours(tx, { userId, bikeId, hoursDelta });
        }
        return newRide;
      });

      // Invalidate prediction cache after transaction
      if (bikeId) {
        await invalidateBikePrediction(userId, bikeId);
      }

      return ride;
    },
    deleteRide: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      const userId = requireUserId(ctx);

      // Rate limit check
      const rateLimit = await checkMutationRateLimit('deleteRide', userId);
      if (!rateLimit.allowed) {
        throw new GraphQLError(`Rate limit exceeded. Try again in ${rateLimit.retryAfter} seconds.`, {
          extensions: { code: 'RATE_LIMITED', retryAfter: rateLimit.retryAfter },
        });
      }

      const ride = await prisma.ride.findUnique({
        where: { id },
        select: { userId: true, durationSeconds: true, bikeId: true },
      });
      if (!ride || ride.userId !== userId) {
        throw new Error('Ride not found');
      }

      const hoursDelta = Math.max(0, ride.durationSeconds ?? 0) / 3600;

      const deletedBikeId = ride.bikeId;

      // Invalidate prediction cache BEFORE transaction to prevent stale reads
      if (deletedBikeId) {
        await invalidateBikePrediction(userId, deletedBikeId);
      }

      await prisma.$transaction(async (tx) => {
        if (ride.bikeId) {
          await decrementBikeComponentHours(tx, { userId, bikeId: ride.bikeId, hoursDelta });
        }

        await tx.ride.delete({ where: { id } });
      });

      // Invalidate prediction cache after transaction
      if (deletedBikeId) {
        await invalidateBikePrediction(userId, deletedBikeId);
      }

      return { ok: true, id };
    },
    updateRide: async (
      _parent: unknown,
      { id, input }: { id: string; input: UpdateRideInput },
      ctx: GraphQLContext
    ) => {
      const userId = requireUserId(ctx);

      // Rate limit check
      const rateLimit = await checkMutationRateLimit('updateRide', userId);
      if (!rateLimit.allowed) {
        throw new GraphQLError(`Rate limit exceeded. Try again in ${rateLimit.retryAfter} seconds.`, {
          extensions: { code: 'RATE_LIMITED', retryAfter: rateLimit.retryAfter },
        });
      }

      const existing = await prisma.ride.findUnique({
        where: { id },
        select: { userId: true, durationSeconds: true, bikeId: true },
      });
      if (!existing || existing.userId !== userId) throw new Error('Ride not found');

      // --- Build a strongly-typed update object (no `any`) ---
      const start = parseIsoOptionalStrict(input.startTime);

      // rideType is NON-nullable in Prisma -> only set when a non-empty string is provided
      const rideType =
        input.rideType === undefined
          ? undefined
          : cleanText(input.rideType, 32) || undefined;

      // Nullable text fields — allow explicit null to clear
      const notes =
        input.notes !== undefined
          ? typeof input.notes === 'string'
            ? cleanText(input.notes, MAX_NOTES_LEN)
            : null
          : undefined;

      const trailSystem =
        input.trailSystem !== undefined
          ? typeof input.trailSystem === 'string'
            ? cleanText(input.trailSystem, MAX_LABEL_LEN)
            : null
          : undefined;

      const location =
        input.location !== undefined
          ? typeof input.location === 'string'
            ? cleanText(input.location, MAX_LABEL_LEN)
            : null
          : undefined;

      let nextDurationSeconds = existing.durationSeconds;
      let durationUpdate: number | undefined;
      if (input.durationSeconds !== undefined) {
        durationUpdate = Math.max(0, Math.floor(input.durationSeconds ?? 0));
        nextDurationSeconds = durationUpdate;
      }

      let nextBikeId: string | null = existing.bikeId ?? null;
      let bikeUpdate: string | null | undefined = undefined;
      if (input.bikeId !== undefined) {
        if (input.bikeId) {
          const ownedBike = await prisma.bike.findUnique({
            where: { id: input.bikeId },
            select: { userId: true },
          });
          if (!ownedBike || ownedBike.userId !== userId) throw new Error('Bike not found');
          bikeUpdate = input.bikeId;
          nextBikeId = input.bikeId;
        } else {
          bikeUpdate = null;
          nextBikeId = null;
        }
      }

      const data: Prisma.RideUpdateInput = {
        ...(start !== undefined && { startTime: start }), // Date (no null)
        ...(durationUpdate !== undefined && {
          durationSeconds: durationUpdate, // number (no null)
        }),
        ...(input.distanceMiles !== undefined && {
          distanceMiles: Math.max(0, Number(input.distanceMiles ?? 0)), // number (no null)
        }),
        ...(input.elevationGainFeet !== undefined && {
          elevationGainFeet: Math.max(0, Number(input.elevationGainFeet ?? 0)), // number (no null)
        }),
        ...(input.averageHr !== undefined && {
          averageHr: input.averageHr == null ? null : Math.max(0, Math.floor(input.averageHr)),
        }),
        ...(rideType !== undefined && { rideType }), // string only; omit if empty/undefined
        ...(bikeUpdate !== undefined && { bikeId: bikeUpdate }), // nullable
        ...(notes !== undefined ? { notes: notes as string | null } : {}),
        ...(trailSystem !== undefined ? { trailSystem: trailSystem as string | null } : {}),
        ...(location !== undefined ? { location: location as string | null } : {}),
      };

      const hoursBefore = Math.max(0, existing.durationSeconds ?? 0) / 3600;
      const hoursAfter = Math.max(0, nextDurationSeconds ?? 0) / 3600;
      const hoursDiff = hoursAfter - hoursBefore;
      const durationChanged = durationUpdate !== undefined;
      const bikeChanged = bikeUpdate !== undefined && nextBikeId !== existing.bikeId;

      // Invalidate prediction cache BEFORE transaction to prevent stale reads
      if (existing.bikeId) {
        await invalidateBikePrediction(userId, existing.bikeId);
      }
      if (nextBikeId && nextBikeId !== existing.bikeId) {
        await invalidateBikePrediction(userId, nextBikeId);
      }

      const updatedRide = await prisma.$transaction(async (tx) => {
        const updated = await tx.ride.update({
          where: { id },
          data,
        });

        if (bikeChanged || durationChanged) {
          // Remove hours from the old bike when it loses the ride or when hours shrink
          if (existing.bikeId) {
            if (bikeChanged) {
              await decrementBikeComponentHours(tx, { userId, bikeId: existing.bikeId, hoursDelta: hoursBefore });
            } else if (durationChanged && hoursDiff < 0) {
              await decrementBikeComponentHours(tx, { userId, bikeId: existing.bikeId, hoursDelta: Math.abs(hoursDiff) });
            }
          }

          // Add hours to the new/current bike when appropriate
          if (nextBikeId) {
            if (bikeChanged) {
              await incrementBikeComponentHours(tx, { userId, bikeId: nextBikeId, hoursDelta: hoursAfter });
            } else if (durationChanged && hoursDiff > 0) {
              await incrementBikeComponentHours(tx, { userId, bikeId: nextBikeId, hoursDelta: hoursDiff });
            }
          }
        }

        return updated;
      });

      // Invalidate prediction cache after transaction
      if (existing.bikeId) {
        await invalidateBikePrediction(userId, existing.bikeId);
      }
      if (nextBikeId && nextBikeId !== existing.bikeId) {
        await invalidateBikePrediction(userId, nextBikeId);
      }

      return updatedRide;
    },

    addBike: async (_: unknown, { input }: { input: AddBikeInputGQL }, ctx: GraphQLContext) => {
      const userId = requireUserId(ctx);

      // Get spokesId first so we can fetch authoritative manufacturer/model
      const spokesId = cleanText(input.spokesId, 64);

      // Use 99spokes API data for manufacturer/model when available
      let manufacturer = cleanText(input.manufacturer, MAX_LABEL_LEN);
      let model = cleanText(input.model, MAX_LABEL_LEN);

      if (spokesId && isSpokesConfigured()) {
        try {
          const spokesData = await getBikeById(spokesId);
          // Only use spokesData if both maker and model are present
          if (spokesData?.maker && spokesData?.model) {
            manufacturer = cleanText(spokesData.maker, MAX_LABEL_LEN);
            model = cleanText(spokesData.model, MAX_LABEL_LEN);
          }
        } catch (error) {
          console.warn('[addBike] Failed to fetch spokes data, using user input:', error);
          // Fall back to user-provided manufacturer/model (already set above)
        }
      }

      if (!manufacturer) throw new Error('manufacturer is required');
      if (!model) throw new Error('model is required');

      const nickname = cleanText(input.nickname, MAX_LABEL_LEN);
      const year = clampYear(input.year);
      const travelForkMm = parseTravel(input.travelForkMm);
      const travelShockMm = parseTravel(input.travelShockMm);
      const notes = cleanText(input.notes, MAX_NOTES_LEN);

      // 99spokes metadata fields
      const spokesUrl = cleanText(input.spokesUrl, 512);
      const thumbnailUrl = cleanText(input.thumbnailUrl, 512);
      const family = cleanText(input.family, MAX_LABEL_LEN);
      const category = cleanText(input.category, MAX_LABEL_LEN);
      const subcategory = cleanText(input.subcategory, MAX_LABEL_LEN);
      const buildKind = cleanText(input.buildKind, MAX_LABEL_LEN);
      const isFrameset = Boolean(input.isFrameset);
      const isEbike = Boolean(input.isEbike);
      const gender = cleanText(input.gender, MAX_LABEL_LEN);
      const frameMaterial = cleanText(input.frameMaterial, MAX_LABEL_LEN);
      const hangerStandard = cleanText(input.hangerStandard, MAX_LABEL_LEN);

      // E-bike motor/battery specs (only store if e-bike)
      const motorMaker = isEbike ? cleanText(input.motorMaker, MAX_LABEL_LEN) : null;
      const motorModel = isEbike ? cleanText(input.motorModel, MAX_LABEL_LEN) : null;
      const motorPowerW = isEbike && input.motorPowerW != null ? Math.max(0, Math.floor(input.motorPowerW)) : null;
      const motorTorqueNm = isEbike && input.motorTorqueNm != null ? Math.max(0, Math.floor(input.motorTorqueNm)) : null;
      const batteryWh = isEbike && input.batteryWh != null ? Math.max(0, Math.floor(input.batteryWh)) : null;

      // Acquisition condition for baseline tracking (default to USED for backwards compatibility)
      const acquisitionCondition: AcquisitionCondition = input.acquisitionCondition ?? 'USED';

      // Derive BikeSpec for dynamic component creation
      const bikeSpec = deriveBikeSpec(
        { travelForkMm, travelShockMm },
        input.spokesComponents as SpokesComponents | undefined
      );

      return prisma.$transaction(async (tx) => {
        const bike = await tx.bike.create({
          data: {
            nickname: nickname ?? null,
            manufacturer,
            model,
            year,
            travelForkMm,
            travelShockMm,
            notes: notes ?? null,
            spokesId: spokesId ?? null,
            spokesUrl: spokesUrl ?? null,
            thumbnailUrl: thumbnailUrl ?? null,
            family: family ?? null,
            category: category ?? null,
            subcategory: subcategory ?? null,
            buildKind: buildKind ?? null,
            isFrameset,
            isEbike,
            gender: gender ?? null,
            frameMaterial: frameMaterial ?? null,
            hangerStandard: hangerStandard ?? null,
            motorMaker,
            motorModel,
            motorPowerW,
            motorTorqueNm,
            batteryWh,
            acquisitionCondition,
            userId,
          },
        });

        // Build components dynamically based on BikeSpec
        await buildBikeComponents(tx, {
          bikeId: bike.id,
          userId,
          bikeSpec,
          spokesComponents: input.spokesComponents,
          userOverrides: {
            fork: input.fork,
            shock: input.shock,
            seatpost: input.seatpost,
            wheels: input.wheels,
            pivotBearings: input.pivotBearings,
          },
          pairedComponentConfigs: input.pairedComponentConfigs,
        });

        return tx.bike.findUnique({
          where: { id: bike.id },
          include: { components: true },
        });
      });
    },

    updateBike: async (
      _: unknown,
      { id, input }: { id: string; input: UpdateBikeInputGQL },
      ctx: GraphQLContext
    ) => {
      const userId = requireUserId(ctx);
      const existing = await prisma.bike.findUnique({
        where: { id },
        select: { userId: true },
      });
      if (!existing || existing.userId !== userId) throw new Error('Bike not found');

      const data: Prisma.BikeUpdateInput = {};

      if (input.nickname !== undefined) data.nickname = cleanText(input.nickname, MAX_LABEL_LEN);
      if (input.manufacturer !== undefined) {
        const manufacturer = cleanText(input.manufacturer, MAX_LABEL_LEN);
        if (!manufacturer) throw new Error('manufacturer is required');
        data.manufacturer = manufacturer;
      }
      if (input.model !== undefined) {
        const updatedModel = cleanText(input.model, MAX_LABEL_LEN);
        if (!updatedModel) throw new Error('model is required');
        data.model = updatedModel;
      }
      if (input.year !== undefined) data.year = input.year == null ? null : clampYear(input.year);
      if (input.travelForkMm !== undefined) data.travelForkMm = parseTravel(input.travelForkMm) ?? null;
      if (input.travelShockMm !== undefined)
        data.travelShockMm = parseTravel(input.travelShockMm) ?? null;
      if (input.notes !== undefined) data.notes = cleanText(input.notes, MAX_NOTES_LEN);
      if (input.spokesId !== undefined) data.spokesId = cleanText(input.spokesId, 64) ?? null;

      // 99spokes metadata fields
      if (input.spokesUrl !== undefined) data.spokesUrl = cleanText(input.spokesUrl, 512) ?? null;
      if (input.thumbnailUrl !== undefined) data.thumbnailUrl = cleanText(input.thumbnailUrl, 512) ?? null;
      if (input.family !== undefined) data.family = cleanText(input.family, MAX_LABEL_LEN) ?? null;
      if (input.category !== undefined) data.category = cleanText(input.category, MAX_LABEL_LEN) ?? null;
      if (input.subcategory !== undefined) data.subcategory = cleanText(input.subcategory, MAX_LABEL_LEN) ?? null;
      if (input.buildKind !== undefined) data.buildKind = cleanText(input.buildKind, MAX_LABEL_LEN) ?? null;
      if (input.isFrameset !== undefined) data.isFrameset = Boolean(input.isFrameset);
      if (input.isEbike !== undefined) data.isEbike = Boolean(input.isEbike);
      if (input.gender !== undefined) data.gender = cleanText(input.gender, MAX_LABEL_LEN) ?? null;
      if (input.frameMaterial !== undefined) data.frameMaterial = cleanText(input.frameMaterial, MAX_LABEL_LEN) ?? null;
      if (input.hangerStandard !== undefined) data.hangerStandard = cleanText(input.hangerStandard, MAX_LABEL_LEN) ?? null;

      // E-bike motor/battery specs
      const isEbike = input.isEbike !== undefined ? Boolean(input.isEbike) : undefined;
      if (input.motorMaker !== undefined) data.motorMaker = isEbike === false ? null : cleanText(input.motorMaker, MAX_LABEL_LEN) ?? null;
      if (input.motorModel !== undefined) data.motorModel = isEbike === false ? null : cleanText(input.motorModel, MAX_LABEL_LEN) ?? null;
      if (input.motorPowerW !== undefined) data.motorPowerW = isEbike === false || input.motorPowerW == null ? null : Math.max(0, Math.floor(input.motorPowerW));
      if (input.motorTorqueNm !== undefined) data.motorTorqueNm = isEbike === false || input.motorTorqueNm == null ? null : Math.max(0, Math.floor(input.motorTorqueNm));
      if (input.batteryWh !== undefined) data.batteryWh = isEbike === false || input.batteryWh == null ? null : Math.max(0, Math.floor(input.batteryWh));

      return prisma.$transaction(async (tx) => {
        if (Object.keys(data).length > 0) {
          await tx.bike.update({ where: { id }, data });
        }

        await syncBikeComponents(tx, {
          bikeId: id,
          userId,
          components: {
            fork: input.fork,
            shock: input.shock,
            seatpost: input.seatpost,
            wheels: input.wheels,
            pivotBearings: input.pivotBearings,
          },
          createMissing: false,
        });

        return tx.bike.findUnique({ where: { id }, include: { components: true } });
      });
    },

    deleteBike: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      const userId = requireUserId(ctx);
      const existing = await prisma.bike.findUnique({
        where: { id },
        select: { userId: true },
      });
      if (!existing || existing.userId !== userId) throw new Error('Bike not found');

      await prisma.$transaction(async (tx) => {
        // Delete all components associated with this bike
        await tx.component.deleteMany({ where: { bikeId: id } });

        // Remove bike association from rides (set bikeId to null)
        await tx.ride.updateMany({
          where: { bikeId: id },
          data: { bikeId: null },
        });

        // Delete any Strava gear mappings for this bike
        await tx.stravaGearMapping.deleteMany({ where: { bikeId: id } });

        // Delete the bike itself
        await tx.bike.delete({ where: { id } });
      });

      return { ok: true, id };
    },

    updateBikesOrder: async (
      _: unknown,
      { bikeIds }: { bikeIds: string[] },
      ctx: GraphQLContext
    ) => {
      const userId = requireUserId(ctx);

      // Validate all bikes exist and belong to the user
      const bikes = await prisma.bike.findMany({
        where: { id: { in: bikeIds }, userId },
        select: { id: true },
      });

      if (bikes.length !== bikeIds.length) {
        throw new Error('One or more bikes not found or not owned by user');
      }

      // Update sortOrder for each bike in a transaction
      await prisma.$transaction(
        bikeIds.map((id, index) =>
          prisma.bike.update({
            where: { id },
            data: { sortOrder: index },
          })
        )
      );

      // Return all bikes with updated order
      return prisma.bike.findMany({
        where: { userId },
        orderBy: { sortOrder: 'asc' },
        include: { components: true },
      });
    },

    addComponent: async (
      _: unknown,
      { input, bikeId }: { input: AddComponentInputGQL; bikeId?: string | null },
      ctx: GraphQLContext
    ) => {
      const userId = requireUserId(ctx);
      const type = input.type;

      if (bikeId) {
        const bike = await prisma.bike.findUnique({
          where: { id: bikeId },
          select: { userId: true },
        });
        if (!bike || bike.userId !== userId) throw new Error('Bike not found');
      } else if (type === ComponentTypeEnum.PIVOT_BEARINGS) {
        throw new Error('Pivot bearings must be attached to a bike');
      }

      // Validate that components needing front/rear designation have proper location
      if (
        (type === ComponentTypeEnum.BRAKE_PAD || type === ComponentTypeEnum.TIRES) &&
        (!input.location || input.location === 'NONE')
      ) {
        const typeName = type.replace('_', ' ').toLowerCase();
        throw new Error(`${typeName} requires a location (FRONT or REAR)`);
      }

      try {
        const now = new Date();
        const location = input.location ?? 'NONE';
        const status = bikeId ? 'INSTALLED' : 'INVENTORY';

        const component = await prisma.$transaction(async (tx) => {
          const created = await tx.component.create({
            data: {
              ...normalizeLooseComponentInput(type, input),
              type,
              location,
              bikeId: bikeId ?? null,
              userId,
              installedAt: bikeId ? now : null,
              status,
            },
          });

          // Create install record if component is being installed on a bike
          if (bikeId) {
            await tx.bikeComponentInstall.create({
              data: {
                userId,
                bikeId,
                componentId: created.id,
                slotKey: getSlotKey(type, location),
                installedAt: now,
              },
            });
          }

          return created;
        });

        return component;
      } catch (error) {
        // Handle race condition: component was created between validation and insert
        if (error instanceof Error && error.message.includes('Unique constraint')) {
          throw new Error('A component of this type already exists for this bike');
        }
        throw error;
      }
    },

    updateComponent: async (
      _: unknown,
      { id, input }: { id: string; input: UpdateComponentInputGQL },
      ctx: GraphQLContext
    ) => {
      const userId = requireUserId(ctx);

      // Rate limit check
      const rateLimit = await checkMutationRateLimit('updateComponent', userId);
      if (!rateLimit.allowed) {
        throw new GraphQLError(`Rate limit exceeded. Try again in ${rateLimit.retryAfter} seconds.`, {
          extensions: { code: 'RATE_LIMITED', retryAfter: rateLimit.retryAfter },
        });
      }

      const existing = await prisma.component.findUnique({ where: { id } });
      if (!existing || existing.userId !== userId) throw new Error('Component not found');

      const normalized = normalizeLooseComponentInput(existing.type, input, {
        brand: existing.brand,
        model: existing.model,
        notes: existing.notes,
        isStock: existing.isStock,
        hoursUsed: existing.hoursUsed,
        serviceDueAtHours: existing.serviceDueAtHours,
      });

      // Invalidate prediction cache BEFORE update to prevent stale reads
      if (existing.bikeId) {
        await invalidateBikePrediction(userId, existing.bikeId);
      }

      const updated = await prisma.component.update({
        where: { id },
        data: {
          ...normalized,
          ...(input.location !== undefined && input.location !== null && { location: input.location }),
        },
      });

      // Invalidate prediction cache after update
      if (existing.bikeId) {
        await invalidateBikePrediction(userId, existing.bikeId);
      }

      return updated;
    },

    deleteComponent: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      const userId = requireUserId(ctx);
      const existing = await prisma.component.findUnique({ where: { id }, select: { userId: true } });
      if (!existing || existing.userId !== userId) throw new Error('Component not found');
      await prisma.component.delete({ where: { id } });
      return { ok: true, id };
    },

    logComponentService: async (
      _: unknown,
      { id, performedAt }: { id: string; performedAt?: string | null },
      ctx: GraphQLContext
    ) => {
      const userId = requireUserId(ctx);

      // Rate limit check
      const rateLimit = await checkMutationRateLimit('logComponentService', userId);
      if (!rateLimit.allowed) {
        throw new GraphQLError(`Rate limit exceeded. Try again in ${rateLimit.retryAfter} seconds.`, {
          extensions: { code: 'RATE_LIMITED', retryAfter: rateLimit.retryAfter },
        });
      }

      // SECURITY: Verify component ownership BEFORE parsing input
      const existing = await prisma.component.findUnique({
        where: { id },
        select: { userId: true, bikeId: true, hoursUsed: true },
      });
      if (!existing || existing.userId !== userId) throw new Error('Component not found');

      // Parse and validate service date AFTER authorization
      let serviceDate = new Date();
      if (performedAt) {
        serviceDate = parseISO(performedAt);
        if (isNaN(serviceDate.getTime())) {
          throw new Error('Invalid date format');
        }
        if (serviceDate > new Date()) {
          throw new Error('Service date cannot be in the future');
        }
      }

      // Invalidate prediction cache BEFORE update to prevent stale reads
      if (existing.bikeId) {
        await invalidateBikePrediction(userId, existing.bikeId);
      }

      // Use transaction to create service log AND reset hours atomically
      const updated = await prisma.$transaction(async (tx) => {
        // Create service log to record this service event
        await tx.serviceLog.create({
          data: {
            componentId: id,
            performedAt: serviceDate,
            hoursAtService: existing.hoursUsed,
          },
        });

        // Reset component hours
        return tx.component.update({
          where: { id },
          data: { hoursUsed: 0 },
        });
      });

      // Invalidate prediction cache after update
      if (existing.bikeId) {
        await invalidateBikePrediction(userId, existing.bikeId);
      }

      return updated;
    },

    logService: async (
      _: unknown,
      { input }: { input: { componentId: string; notes?: string | null; performedAt?: string | null } },
      ctx: GraphQLContext
    ) => {
      const userId = requireUserId(ctx);

      // Rate limit check
      const rateLimit = await checkMutationRateLimit('logService', userId);
      if (!rateLimit.allowed) {
        throw new GraphQLError(`Rate limit exceeded. Try again in ${rateLimit.retryAfter} seconds.`, {
          extensions: { code: 'RATE_LIMITED', retryAfter: rateLimit.retryAfter },
        });
      }

      // Verify component ownership
      const component = await prisma.component.findUnique({
        where: { id: input.componentId },
        select: { userId: true, bikeId: true, hoursUsed: true },
      });

      if (!component || component.userId !== userId) {
        throw new Error('Component not found');
      }

      let performedAt = new Date();
      if (input.performedAt) {
        performedAt = parseISO(input.performedAt);
        if (isNaN(performedAt.getTime())) {
          throw new Error('Invalid date format');
        }
        if (performedAt > new Date()) {
          throw new Error('Service date cannot be in the future');
        }
      }
      const notes = input.notes ? cleanText(input.notes, MAX_NOTES_LEN) : null;

      // Invalidate prediction cache BEFORE transaction to prevent stale reads
      if (component.bikeId) {
        await invalidateBikePrediction(userId, component.bikeId);
      }

      const serviceLog = await prisma.$transaction(async (tx) => {
        // Create service log
        const log = await tx.serviceLog.create({
          data: {
            componentId: input.componentId,
            performedAt,
            notes,
            hoursAtService: component.hoursUsed,
          },
        });

        // Reset component hours
        await tx.component.update({
          where: { id: input.componentId },
          data: { hoursUsed: 0 },
        });

        return log;
      });

      // Invalidate prediction cache after transaction
      if (component.bikeId) {
        await invalidateBikePrediction(userId, component.bikeId);
      }

      return serviceLog;
    },

    snoozeComponent: async (
      _: unknown,
      { id, hours }: { id: string; hours?: number },
      ctx: GraphQLContext
    ) => {
      const userId = requireUserId(ctx);

      // Rate limit check
      const rateLimit = await checkMutationRateLimit('snoozeComponent', userId);
      if (!rateLimit.allowed) {
        throw new GraphQLError(`Rate limit exceeded. Try again in ${rateLimit.retryAfter} seconds.`, {
          extensions: { code: 'RATE_LIMITED', retryAfter: rateLimit.retryAfter },
        });
      }

      // Verify component ownership
      const existing = await prisma.component.findUnique({
        where: { id },
        select: { userId: true, bikeId: true, type: true, location: true, serviceDueAtHours: true },
      });
      if (!existing || existing.userId !== userId) {
        throw new Error('Component not found');
      }

      // Get current interval
      const currentInterval =
        existing.serviceDueAtHours ?? getBaseInterval(existing.type, existing.location);

      // Calculate snooze amount:
      // - If hours provided: use that value (clamped between 1 and 400)
      // - If no hours: use current interval (recommended snooze)
      const snoozeHours =
        hours != null ? Math.min(400, Math.max(1, hours)) : currentInterval;

      const extendedInterval = currentInterval + snoozeHours;

      // Invalidate prediction cache BEFORE update
      if (existing.bikeId) {
        await invalidateBikePrediction(userId, existing.bikeId);
      }

      // Update component with extended service interval
      const updated = await prisma.component.update({
        where: { id },
        data: { serviceDueAtHours: extendedInterval },
      });

      // Invalidate prediction cache AFTER update
      if (existing.bikeId) {
        await invalidateBikePrediction(userId, existing.bikeId);
      }

      return updated;
    },

    createStravaGearMapping: async (
      _: unknown,
      { input }: { input: { stravaGearId: string; stravaGearName?: string | null; bikeId: string } },
      ctx: GraphQLContext
    ) => {
      const userId = requireUserId(ctx);

      // Rate limit check
      const rateLimit = await checkMutationRateLimit('createStravaGearMapping', userId);
      if (!rateLimit.allowed) {
        throw new GraphQLError(`Rate limit exceeded. Try again in ${rateLimit.retryAfter} seconds.`, {
          extensions: { code: 'RATE_LIMITED', retryAfter: rateLimit.retryAfter },
        });
      }

      const bike = await prisma.bike.findUnique({
        where: { id: input.bikeId },
        select: { userId: true },
      });
      if (!bike || bike.userId !== userId) {
        throw new Error('Bike not found');
      }

      const existing = await prisma.stravaGearMapping.findUnique({
        where: {
          userId_stravaGearId: { userId, stravaGearId: input.stravaGearId },
        },
      });
      if (existing) {
        throw new Error('This Strava bike is already mapped');
      }

      const mapping = await prisma.$transaction(async (tx) => {
        const newMapping = await tx.stravaGearMapping.create({
          data: {
            userId,
            stravaGearId: input.stravaGearId,
            stravaGearName: input.stravaGearName ?? null,
            bikeId: input.bikeId,
          },
          include: { bike: true },
        });

        const ridesToUpdate = await tx.ride.findMany({
          where: { userId, stravaGearId: input.stravaGearId, bikeId: null },
          select: { id: true, durationSeconds: true },
        });

        if (ridesToUpdate.length > 0) {
          await tx.ride.updateMany({
            where: { userId, stravaGearId: input.stravaGearId },
            data: { bikeId: input.bikeId },
          });

          const totalSeconds = ridesToUpdate.reduce((sum, r) => sum + r.durationSeconds, 0);
          const totalHours = totalSeconds / 3600;

          await incrementBikeComponentHours(tx, { userId, bikeId: input.bikeId, hoursDelta: totalHours });
        }

        return newMapping;
      });

      // Invalidate prediction cache for the bike
      await invalidateBikePrediction(userId, input.bikeId);

      return mapping;
    },

    deleteStravaGearMapping: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      const userId = requireUserId(ctx);

      // Rate limit check
      const rateLimit = await checkMutationRateLimit('deleteStravaGearMapping', userId);
      if (!rateLimit.allowed) {
        throw new GraphQLError(`Rate limit exceeded. Try again in ${rateLimit.retryAfter} seconds.`, {
          extensions: { code: 'RATE_LIMITED', retryAfter: rateLimit.retryAfter },
        });
      }

      const mapping = await prisma.stravaGearMapping.findUnique({
        where: { id },
        select: { userId: true, stravaGearId: true, bikeId: true },
      });
      if (!mapping || mapping.userId !== userId) {
        throw new Error('Mapping not found');
      }

      const deletedBikeId = mapping.bikeId;

      await prisma.$transaction(async (tx) => {
        const rides = await tx.ride.findMany({
          where: { userId, stravaGearId: mapping.stravaGearId, bikeId: mapping.bikeId },
          select: { durationSeconds: true },
        });

        const totalSeconds = rides.reduce((sum, r) => sum + r.durationSeconds, 0);
        const totalHours = totalSeconds / 3600;

        await tx.ride.updateMany({
          where: { userId, stravaGearId: mapping.stravaGearId },
          data: { bikeId: null },
        });

        await decrementBikeComponentHours(tx, { userId, bikeId: mapping.bikeId, hoursDelta: totalHours });

        await tx.stravaGearMapping.delete({ where: { id } });
      });

      // Invalidate prediction cache for the bike
      await invalidateBikePrediction(userId, deletedBikeId);

      return { ok: true, id };
    },

    triggerProviderSync: async (
      _: unknown,
      { provider }: { provider: 'STRAVA' | 'GARMIN' | 'SUUNTO' },
      ctx: GraphQLContext
    ) => {
      const userId = requireUserId(ctx);

      // Block Garmin manual sync during partner verification window
      // This prevents "unprompted pull" errors in Garmin's verification tool
      if (provider === 'GARMIN' && config.garminVerificationMode) {
        throw new GraphQLError(
          'Manual Garmin sync is temporarily disabled during partner verification. Activities will sync automatically via webhooks.',
          {
            extensions: {
              code: 'VERIFICATION_MODE',
            },
          }
        );
      }

      // Convert GraphQL enum to queue provider type
      const providerLower = provider.toLowerCase() as SyncProvider;

      // Check rate limit (60 second cooldown per provider per user)
      const rateLimitResult = await checkRateLimit('syncLatest', providerLower, userId);

      if (!rateLimitResult.allowed) {
        // Round up to nearest 10 seconds to avoid leaking exact timing info
        const roundedRetry = Math.ceil(rateLimitResult.retryAfter / 10) * 10;
        throw new GraphQLError(
          `Please wait before syncing ${provider} again`,
          {
            extensions: {
              code: 'RATE_LIMITED',
              retryAfter: roundedRetry,
            },
          }
        );
      }

      // Enqueue the sync job with deduplication
      const enqueueResult = await enqueueSyncJob('syncLatest', {
        userId,
        provider: providerLower,
      });

      if (enqueueResult.status === 'already_queued') {
        return {
          status: 'ALREADY_QUEUED',
          message: `A sync for ${provider} is already in progress`,
          jobId: enqueueResult.jobId,
        };
      }

      return {
        status: 'QUEUED',
        message: `${provider} sync has been queued`,
        jobId: enqueueResult.jobId,
      };
    },

    bulkUpdateComponentBaselines: async (
      _: unknown,
      { input }: { input: BulkUpdateBaselinesInputGQL },
      ctx: GraphQLContext
    ) => {
      const userId = requireUserId(ctx);

      // Rate limit check
      const rateLimit = await checkMutationRateLimit('bulkUpdateComponentBaselines', userId);
      if (!rateLimit.allowed) {
        throw new GraphQLError(`Rate limit exceeded. Try again in ${rateLimit.retryAfter} seconds.`, {
          extensions: { code: 'RATE_LIMITED', retryAfter: rateLimit.retryAfter },
        });
      }

      if (!input.updates || input.updates.length === 0) {
        return [];
      }

      // Limit batch size to prevent abuse
      if (input.updates.length > 50) {
        throw new Error('Cannot update more than 50 components at once');
      }

      const componentIds = input.updates.map((u) => u.componentId);

      // Verify ownership of all components and fetch bike data for date validation
      const components = await prisma.component.findMany({
        where: { id: { in: componentIds } },
        select: { id: true, userId: true, bikeId: true, bike: { select: { createdAt: true } } },
      });

      const componentMap = new Map(components.map((c) => [c.id, c]));
      const bikeIdsToInvalidate = new Set<string>();

      for (const update of input.updates) {
        const component = componentMap.get(update.componentId);
        if (!component) {
          throw new Error(`Component ${update.componentId} not found`);
        }
        if (component.userId !== userId) {
          throw new Error('Unauthorized');
        }
        if (component.bikeId) {
          bikeIdsToInvalidate.add(component.bikeId);
        }
        // Validate wearPercent bounds (reject invalid values instead of silent clamp)
        if (update.wearPercent < 0 || update.wearPercent > 100) {
          throw new Error(`wearPercent must be between 0 and 100, got ${update.wearPercent}`);
        }
        // Note: We intentionally allow backdating lastServicedAt before the bike was added
        // to support calibration of historical service data
      }

      // Update all components
      const baselineSetAt = new Date();
      const updatedComponents = await prisma.$transaction(async (tx) => {
        const results = await Promise.all(
          input.updates.map((update) => {
            const wearPercent = update.wearPercent;

            // Calculate confidence based on method
            let confidence: BaselineConfidence;
            if (update.method === 'DATES' && update.lastServicedAt) {
              confidence = 'HIGH';
            } else if (update.method === 'SLIDER') {
              confidence = 'MEDIUM';
            } else {
              confidence = 'LOW';
            }

            // Parse lastServicedAt if provided
            let lastServicedAt: Date | null = null;
            if (update.lastServicedAt) {
              lastServicedAt = parseISO(update.lastServicedAt);
              if (isNaN(lastServicedAt.getTime())) {
                throw new Error('Invalid lastServicedAt date format');
              }
              if (lastServicedAt > new Date()) {
                throw new Error('lastServicedAt cannot be in the future');
              }
            }

            return tx.component.update({
              where: { id: update.componentId },
              data: {
                baselineWearPercent: wearPercent,
                baselineMethod: update.method,
                baselineConfidence: confidence,
                baselineSetAt,
                lastServicedAt,
              },
            });
          })
        );
        return results;
      });

      // Invalidate prediction caches for affected bikes
      for (const bikeId of bikeIdsToInvalidate) {
        await invalidateBikePrediction(userId, bikeId);
      }

      return updatedComponents;
    },

    acceptTerms: async (
      _: unknown,
      { input }: { input: { termsVersion: string } },
      ctx: GraphQLContext
    ) => {
      const userId = requireUserId(ctx);

      // Validate version matches current
      if (input.termsVersion !== CURRENT_TERMS_VERSION) {
        throw new GraphQLError('Invalid terms version', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      // Extract IP and User Agent from request
      // Use rightmost IP from x-forwarded-for (added by trusted proxy) to prevent spoofing
      const forwardedFor = ctx.req.headers['x-forwarded-for'];
      const ipAddress =
        ctx.req.ip ||
        (typeof forwardedFor === 'string'
          ? forwardedFor.split(',').pop()?.trim()
          : Array.isArray(forwardedFor)
          ? forwardedFor[forwardedFor.length - 1]?.split(',').pop()?.trim()
          : null) ||
        null;
      const userAgent =
        (typeof ctx.req.headers['user-agent'] === 'string'
          ? ctx.req.headers['user-agent']
          : null) || null;

      // Upsert to make idempotent (don't fail on duplicate)
      const acceptance = await prisma.termsAcceptance.upsert({
        where: {
          userId_termsVersion: {
            userId,
            termsVersion: input.termsVersion,
          },
        },
        create: {
          userId,
          termsVersion: input.termsVersion,
          ipAddress,
          userAgent,
        },
        update: {}, // No update if exists - keep original timestamp
      });

      return {
        success: true,
        acceptedAt: acceptance.acceptedAt.toISOString(),
      };
    },

    updateUserPreferences: async (
      _: unknown,
      { input }: { input: { hoursDisplayPreference?: string | null; predictionMode?: string | null } },
      ctx: GraphQLContext
    ) => {
      const userId = requireUserId(ctx);

      const updateData: { hoursDisplayPreference?: string | null; predictionMode?: string | null } = {};

      if (input.hoursDisplayPreference !== undefined) {
        // Input length validation to prevent DoS/excessive storage
        if (input.hoursDisplayPreference !== null && input.hoursDisplayPreference.length > 20) {
          throw new GraphQLError('hoursDisplayPreference exceeds maximum length', {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }
        // Validate the preference value
        if (input.hoursDisplayPreference !== null &&
            input.hoursDisplayPreference !== 'total' &&
            input.hoursDisplayPreference !== 'remaining') {
          throw new GraphQLError('Invalid hoursDisplayPreference value. Must be "total" or "remaining"', {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }
        updateData.hoursDisplayPreference = input.hoursDisplayPreference;
      }

      if (input.predictionMode !== undefined) {
        // Validate predictionMode value
        if (input.predictionMode !== null &&
            input.predictionMode !== 'simple' &&
            input.predictionMode !== 'predictive') {
          throw new GraphQLError('Invalid predictionMode value. Must be "simple" or "predictive"', {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }
        // Only allow "predictive" for PRO/ADMIN users
        if (input.predictionMode === 'predictive') {
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { role: true },
          });
          if (user?.role !== 'PRO' && user?.role !== 'ADMIN') {
            throw new GraphQLError('Predictive mode is only available for Pro users', {
              extensions: { code: 'FORBIDDEN' },
            });
          }
        }
        updateData.predictionMode = input.predictionMode;
      }

      if (Object.keys(updateData).length === 0) {
        return prisma.user.findUnique({ where: { id: userId } });
      }

      return prisma.user.update({
        where: { id: userId },
        data: updateData,
      });
    },

    updateServicePreferences: async (
      _: unknown,
      { input }: { input: { preferences: Array<{ componentType: ComponentTypeLiteral; trackingEnabled: boolean; customInterval?: number | null }> } },
      ctx: GraphQLContext
    ) => {
      const userId = requireUserId(ctx);

      // Rate limit check
      const rateLimit = await checkMutationRateLimit('updateServicePreferences', userId);
      if (!rateLimit.allowed) {
        throw new GraphQLError(`Rate limit exceeded. Try again in ${rateLimit.retryAfter} seconds.`, {
          extensions: { code: 'RATE_LIMITED', retryAfter: rateLimit.retryAfter },
        });
      }

      // Validate preferences
      validateServicePreferences(input.preferences);

      // Upsert all preferences in a transaction
      const results = await prisma.$transaction(
        input.preferences.map(pref =>
          prisma.userServicePreference.upsert({
            where: {
              userId_componentType: {
                userId,
                componentType: pref.componentType,
              },
            },
            create: {
              userId,
              componentType: pref.componentType,
              trackingEnabled: pref.trackingEnabled,
              customInterval: pref.customInterval ?? null,
            },
            update: {
              trackingEnabled: pref.trackingEnabled,
              customInterval: pref.customInterval ?? null,
            },
          })
        )
      );

      // Invalidate prediction cache for all user's bikes
      const { invalidateUserPredictions } = await import('../services/prediction/cache');
      await invalidateUserPredictions(userId);

      return results;
    },

    updateBikeServicePreferences: async (
      _: unknown,
      { input }: { input: { bikeId: string; preferences: Array<{ componentType: ComponentTypeLiteral; trackingEnabled: boolean; customInterval?: number | null }> } },
      ctx: GraphQLContext
    ) => {
      const userId = requireUserId(ctx);

      // Rate limit check
      const rateLimit = await checkMutationRateLimit('updateBikeServicePreferences', userId);
      if (!rateLimit.allowed) {
        throw new GraphQLError(`Rate limit exceeded. Try again in ${rateLimit.retryAfter} seconds.`, {
          extensions: { code: 'RATE_LIMITED', retryAfter: rateLimit.retryAfter },
        });
      }

      // Verify bike belongs to user
      const bike = await prisma.bike.findUnique({
        where: { id: input.bikeId },
        select: { userId: true },
      });

      if (!bike || bike.userId !== userId) {
        throw new GraphQLError('Bike not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      // Validate preferences
      validateServicePreferences(input.preferences);

      // Wrap delete and upsert in a single transaction to prevent race conditions
      const results = await prisma.$transaction(async (tx) => {
        // Delete any existing bike preferences that are NOT in the input
        // (i.e., user removed the override and wants to use global default)
        await tx.bikeServicePreference.deleteMany({
          where: {
            bikeId: input.bikeId,
            componentType: { notIn: input.preferences.map(p => p.componentType) },
          },
        });

        // Upsert all preferences that have overrides
        if (input.preferences.length > 0) {
          return Promise.all(
            input.preferences.map(pref =>
              tx.bikeServicePreference.upsert({
                where: {
                  bikeId_componentType: {
                    bikeId: input.bikeId,
                    componentType: pref.componentType,
                  },
                },
                create: {
                  bikeId: input.bikeId,
                  componentType: pref.componentType,
                  trackingEnabled: pref.trackingEnabled,
                  customInterval: pref.customInterval ?? null,
                },
                update: {
                  trackingEnabled: pref.trackingEnabled,
                  customInterval: pref.customInterval ?? null,
                },
              })
            )
          );
        }
        return [];
      });

      // Invalidate prediction cache for this bike
      const { invalidateBikePrediction } = await import('../services/prediction/cache');
      await invalidateBikePrediction(userId, input.bikeId);

      return results;
    },

    acknowledgeImportOverlay: async (
      _: unknown,
      { importSessionId }: { importSessionId: string },
      ctx: GraphQLContext
    ) => {
      const userId = requireUserId(ctx);

      // Verify the session belongs to the user
      const session = await prisma.importSession.findUnique({
        where: { id: importSessionId },
        select: { userId: true },
      });

      if (!session || session.userId !== userId) {
        throw new Error('Import session not found');
      }

      await prisma.importSession.update({
        where: { id: importSessionId },
        data: { userAcknowledgedAt: new Date() },
      });

      return { success: true };
    },

    assignBikeToRides: async (
      _: unknown,
      { rideIds, bikeId }: { rideIds: string[]; bikeId: string },
      ctx: GraphQLContext
    ) => {
      const userId = requireUserId(ctx);

      // Limit array size to prevent memory/performance issues
      const MAX_RIDES_PER_ASSIGNMENT = 2000;
      if (rideIds.length > MAX_RIDES_PER_ASSIGNMENT) {
        throw new GraphQLError(`Cannot assign more than ${MAX_RIDES_PER_ASSIGNMENT} rides at once`, {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      // Rate limit check
      const rateLimit = await checkMutationRateLimit('assignBikeToRides', userId);
      if (!rateLimit.allowed) {
        throw new GraphQLError(`Rate limit exceeded. Try again in ${rateLimit.retryAfter} seconds.`, {
          extensions: { code: 'RATE_LIMITED', retryAfter: rateLimit.retryAfter },
        });
      }

      // Verify the bike belongs to the user
      const bike = await prisma.bike.findUnique({
        where: { id: bikeId },
        select: { userId: true },
      });

      if (!bike || bike.userId !== userId) {
        throw new Error('Bike not found');
      }

      // Verify all rides belong to the user and don't already have a bike assigned
      const rides = await prisma.ride.findMany({
        where: { id: { in: rideIds } },
        select: { id: true, userId: true, bikeId: true, durationSeconds: true },
      });

      if (rides.length !== rideIds.length) {
        throw new Error('One or more rides not found');
      }

      for (const ride of rides) {
        if (ride.userId !== userId) {
          throw new Error('Unauthorized');
        }
        if (ride.bikeId) {
          throw new Error('One or more rides already have a bike assigned');
        }
      }

      // Calculate total hours to add to component wear
      const totalSeconds = rides.reduce((sum, r) => sum + r.durationSeconds, 0);
      const totalHours = totalSeconds / 3600;

      // Invalidate prediction cache BEFORE transaction
      await invalidateBikePrediction(userId, bikeId);

      // Update rides and components in a transaction
      await prisma.$transaction(async (tx) => {
        // Assign bike to all rides
        await tx.ride.updateMany({
          where: { id: { in: rideIds } },
          data: { bikeId },
        });

        // Add hours to bike's components
        await incrementBikeComponentHours(tx, { userId, bikeId, hoursDelta: totalHours });
      });

      // Invalidate prediction cache after transaction
      await invalidateBikePrediction(userId, bikeId);

      return {
        success: true,
        updatedCount: rideIds.length,
      };
    },

    logBulkComponentService: async (
      _: unknown,
      { input }: { input: { componentIds: string[]; performedAt: string } },
      ctx: GraphQLContext
    ) => {
      const userId = requireUserId(ctx);

      // Rate limit check
      const rateLimit = await checkMutationRateLimit('logBulkComponentService', userId);
      if (!rateLimit.allowed) {
        throw new GraphQLError(`Rate limit exceeded. Try again in ${rateLimit.retryAfter} seconds.`, {
          extensions: { code: 'RATE_LIMITED', retryAfter: rateLimit.retryAfter },
        });
      }

      // Limit batch size
      const MAX_COMPONENTS_PER_BULK = 50;
      if (input.componentIds.length > MAX_COMPONENTS_PER_BULK) {
        throw new GraphQLError(`Cannot log service for more than ${MAX_COMPONENTS_PER_BULK} components at once`, {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      if (input.componentIds.length === 0) {
        return { success: true, updatedCount: 0 };
      }

      // Parse and validate service date
      const serviceDate = parseISO(input.performedAt);
      if (isNaN(serviceDate.getTime())) {
        throw new GraphQLError('Invalid date format', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }
      if (serviceDate > new Date()) {
        throw new GraphQLError('Service date cannot be in the future', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      // Reject unreasonably old dates (more than 20 years ago)
      const minReasonableDate = new Date();
      minReasonableDate.setFullYear(minReasonableDate.getFullYear() - 20);
      if (serviceDate < minReasonableDate) {
        throw new GraphQLError('Service date is too far in the past', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      // Verify ownership of all components and get bike IDs for cache invalidation
      const components = await prisma.component.findMany({
        where: { id: { in: input.componentIds } },
        select: {
          id: true,
          userId: true,
          bikeId: true,
          hoursUsed: true,
          bike: { select: { createdAt: true } },
        },
      });

      if (components.length !== input.componentIds.length) {
        throw new GraphQLError('One or more components not found', {
          extensions: { code: 'NOT_FOUND' },
        });
      }

      const bikeIdsToInvalidate = new Set<string>();
      for (const component of components) {
        if (component.userId !== userId) {
          throw new GraphQLError('Unauthorized', {
            extensions: { code: 'FORBIDDEN' },
          });
        }
        if (component.bikeId) {
          bikeIdsToInvalidate.add(component.bikeId);
        }
        // Note: We intentionally allow backdating service logs before the bike was added
        // to support calibration of historical service data
      }

      // Invalidate prediction caches BEFORE transaction
      for (const bikeId of bikeIdsToInvalidate) {
        await invalidateBikePrediction(userId, bikeId);
      }

      // Create service logs and reset hours in transaction
      await prisma.$transaction(async (tx) => {
        for (const component of components) {
          // Create service log
          await tx.serviceLog.create({
            data: {
              componentId: component.id,
              performedAt: serviceDate,
              hoursAtService: component.hoursUsed,
            },
          });

          // Reset component hours
          await tx.component.update({
            where: { id: component.id },
            data: { hoursUsed: 0 },
          });
        }
      });

      // Invalidate prediction caches after transaction
      for (const bikeId of bikeIdsToInvalidate) {
        await invalidateBikePrediction(userId, bikeId);
      }

      return {
        success: true,
        updatedCount: components.length,
      };
    },

    dismissCalibration: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
      const userId = requireUserId(ctx);

      return prisma.user.update({
        where: { id: userId },
        data: { calibrationDismissedAt: new Date() },
      });
    },

    completeCalibration: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
      const userId = requireUserId(ctx);

      return prisma.user.update({
        where: { id: userId },
        data: {
          calibrationCompletedAt: new Date(),
          calibrationDismissedAt: null, // Clear dismissed state if completing
        },
      });
    },

    resetCalibration: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
      const userId = requireUserId(ctx);

      return prisma.user.update({
        where: { id: userId },
        data: {
          calibrationCompletedAt: null,
          calibrationDismissedAt: null,
        },
      });
    },

    markPairedComponentMigrationSeen: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
      const userId = requireUserId(ctx);

      // Rate limit check
      const rateLimit = await checkMutationRateLimit('markPairedComponentMigrationSeen', userId);
      if (!rateLimit.allowed) {
        throw new GraphQLError(`Rate limit exceeded. Try again in ${rateLimit.retryAfter} seconds.`, {
          extensions: { code: 'RATE_LIMITED', retryAfter: rateLimit.retryAfter },
        });
      }

      return prisma.user.update({
        where: { id: userId },
        data: {
          pairedComponentMigrationSeenAt: new Date(),
        },
      });
    },

    replaceComponent: async (
      _: unknown,
      { input }: { input: ReplaceComponentInputGQL },
      ctx: GraphQLContext
    ) => {
      const userId = requireUserId(ctx);

      // Rate limit check
      const rateLimit = await checkMutationRateLimit('replaceComponent', userId);
      if (!rateLimit.allowed) {
        throw new GraphQLError(`Rate limit exceeded. Try again in ${rateLimit.retryAfter} seconds.`, {
          extensions: { code: 'RATE_LIMITED', retryAfter: rateLimit.retryAfter },
        });
      }

      const { componentId, newBrand, newModel, alsoReplacePair, pairBrand, pairModel } = input;

      // Find the component to replace
      const existingComponent = await prisma.component.findFirst({
        where: { id: componentId, userId },
      });

      if (!existingComponent) {
        throw new GraphQLError('Component not found', { extensions: { code: 'NOT_FOUND' } });
      }

      const replacedComponents: ComponentModel[] = [];
      const newComponents: ComponentModel[] = [];

      await prisma.$transaction(async (tx) => {
        const now = new Date();
        const newPairGroupId = createId();

        // Retire the existing component
        // Set bikeId to null to avoid unique constraint violation when creating replacement
        const retired = await tx.component.update({
          where: { id: componentId },
          data: { retiredAt: now, bikeId: null },
        });
        replacedComponents.push(retired);

        // Create the new component
        const newComponent = await tx.component.create({
          data: {
            type: existingComponent.type,
            location: existingComponent.location,
            bikeId: existingComponent.bikeId,
            userId,
            brand: newBrand,
            model: newModel,
            isStock: false,
            hoursUsed: 0,
            installedAt: now,
            baselineWearPercent: 0,
            baselineMethod: 'DEFAULT',
            baselineConfidence: 'HIGH',
            baselineSetAt: now,
            pairGroupId: requiresPairing(existingComponent.type) ? newPairGroupId : null,
          },
        });
        newComponents.push(newComponent);

        // Update the old component to point to the replacement
        await tx.component.update({
          where: { id: componentId },
          data: { replacedById: newComponent.id },
        });

        // Handle paired component replacement if requested
        if (alsoReplacePair && existingComponent.pairGroupId) {
          // Find the paired component
          const pairedComponent = await tx.component.findFirst({
            where: {
              pairGroupId: existingComponent.pairGroupId,
              id: { not: componentId },
              retiredAt: null,
            },
          });

          if (pairedComponent) {
            // Retire the paired component
            // Set bikeId to null to avoid unique constraint violation when creating replacement
            const retiredPair = await tx.component.update({
              where: { id: pairedComponent.id },
              data: { retiredAt: now, bikeId: null },
            });
            replacedComponents.push(retiredPair);

            // Create the new paired component
            const newPairedComponent = await tx.component.create({
              data: {
                type: pairedComponent.type,
                location: pairedComponent.location,
                bikeId: pairedComponent.bikeId,
                userId,
                brand: pairBrand || newBrand,
                model: pairModel || newModel,
                isStock: false,
                hoursUsed: 0,
                installedAt: now,
                baselineWearPercent: 0,
                baselineMethod: 'DEFAULT',
                baselineConfidence: 'HIGH',
                baselineSetAt: now,
                pairGroupId: newPairGroupId,
              },
            });
            newComponents.push(newPairedComponent);

            // Update the old paired component to point to the replacement
            await tx.component.update({
              where: { id: pairedComponent.id },
              data: { replacedById: newPairedComponent.id },
            });
          }
        }

        // Invalidate prediction cache for affected bikes
        if (existingComponent.bikeId) {
          await invalidateBikePrediction(userId, existingComponent.bikeId);
        }
      });

      return { replacedComponents, newComponents };
    },

    installComponent: async (
      _: unknown,
      { input }: { input: InstallComponentInputGQL },
      ctx: GraphQLContext
    ) => {
      const userId = requireUserId(ctx);

      const rateLimit = await checkMutationRateLimit('installComponent', userId);
      if (!rateLimit.allowed) {
        throw new GraphQLError(`Rate limit exceeded. Try again in ${rateLimit.retryAfter} seconds.`, {
          extensions: { code: 'RATE_LIMITED', retryAfter: rateLimit.retryAfter },
        });
      }

      const { bikeId, slotKey, existingComponentId, newComponent, alsoReplacePair, pairNewComponent } = input;

      // Must provide exactly one of existingComponentId or newComponent
      if (!existingComponentId && !newComponent) {
        throw new GraphQLError('Must provide either existingComponentId or newComponent', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }
      if (existingComponentId && newComponent) {
        throw new GraphQLError('Provide only one of existingComponentId or newComponent', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      const { type: slotType, location: slotLocation } = parseSlotKey(slotKey);

      // Validate bike ownership
      const bike = await prisma.bike.findFirst({ where: { id: bikeId, userId } });
      if (!bike) {
        throw new GraphQLError('Bike not found', { extensions: { code: 'NOT_FOUND' } });
      }

      // If installing an existing component, validate it
      let existingComponent: ComponentModel | null = null;
      if (existingComponentId) {
        existingComponent = await prisma.component.findFirst({
          where: { id: existingComponentId, userId },
        });
        if (!existingComponent) {
          throw new GraphQLError('Component not found', { extensions: { code: 'NOT_FOUND' } });
        }
        if (existingComponent.type !== slotType) {
          throw new GraphQLError('Component type does not match slot', {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }
      }

      let installedComponent: ComponentModel | null = null;
      let displacedComponent: ComponentModel | null = null;
      const bikesToInvalidate = new Set<string>([bikeId]);

      await prisma.$transaction(async (tx) => {
        const now = new Date();

        // 1. If the incoming component is currently installed somewhere, uninstall it
        if (existingComponent && existingComponent.bikeId) {
          const sourceInstall = await tx.bikeComponentInstall.findFirst({
            where: { componentId: existingComponent.id, removedAt: null },
          });
          if (sourceInstall) {
            await tx.bikeComponentInstall.update({
              where: { id: sourceInstall.id },
              data: { removedAt: now },
            });
            if (sourceInstall.bikeId !== bikeId) {
              bikesToInvalidate.add(sourceInstall.bikeId);
            }
          }
          await tx.component.update({
            where: { id: existingComponent.id },
            data: { bikeId: null, status: 'INVENTORY' },
          });
        }

        // 2. Close current install on target slot (displace current component)
        const currentInstall = await tx.bikeComponentInstall.findFirst({
          where: { bikeId, slotKey, removedAt: null },
        });
        if (currentInstall) {
          await tx.bikeComponentInstall.update({
            where: { id: currentInstall.id },
            data: { removedAt: now },
          });

          if (newComponent) {
            // Fresh replacement: retire the old component
            displacedComponent = await tx.component.update({
              where: { id: currentInstall.componentId },
              data: { bikeId: null, status: 'RETIRED', retiredAt: now },
            });
          } else {
            // Swapping with existing spare: displaced component becomes inventory
            displacedComponent = await tx.component.update({
              where: { id: currentInstall.componentId },
              data: { bikeId: null, status: 'INVENTORY', installedAt: null },
            });
          }
        }

        // 3. Create or use existing component
        let componentToInstall: ComponentModel;

        if (newComponent) {
          componentToInstall = await tx.component.create({
            data: {
              type: slotType as ComponentTypeLiteral,
              location: slotLocation as ComponentLocation,
              bikeId,
              userId,
              brand: newComponent.brand,
              model: newComponent.model,
              isStock: newComponent.isStock ?? false,
              hoursUsed: 0,
              installedAt: now,
              baselineWearPercent: 0,
              baselineMethod: 'DEFAULT',
              baselineConfidence: 'HIGH',
              baselineSetAt: now,
              status: 'INSTALLED',
            },
          });

          // Set replacedById chain if we displaced a component
          if (displacedComponent) {
            await tx.component.update({
              where: { id: displacedComponent.id },
              data: { replacedById: componentToInstall.id },
            });
          }
        } else {
          // Update the existing component to be installed on target bike
          componentToInstall = await tx.component.update({
            where: { id: existingComponent!.id },
            data: {
              bikeId,
              status: 'INSTALLED',
              installedAt: now,
              location: slotLocation as ComponentLocation,
            },
          });
        }

        // 4. Create new install record
        await tx.bikeComponentInstall.create({
          data: {
            userId,
            bikeId,
            componentId: componentToInstall.id,
            slotKey,
            installedAt: now,
          },
        });

        installedComponent = componentToInstall;

        // 5. Handle paired component if requested
        if (alsoReplacePair && requiresPairing(slotType)) {
          const pairedLocation = slotLocation === 'FRONT' ? 'REAR' : 'FRONT';
          const pairedSlotKey = getSlotKey(slotType, pairedLocation);

          // Close current install on paired slot
          const pairedInstall = await tx.bikeComponentInstall.findFirst({
            where: { bikeId, slotKey: pairedSlotKey, removedAt: null },
          });
          if (pairedInstall) {
            await tx.bikeComponentInstall.update({
              where: { id: pairedInstall.id },
              data: { removedAt: now },
            });

            if (pairNewComponent || newComponent) {
              // Retire the paired component
              await tx.component.update({
                where: { id: pairedInstall.componentId },
                data: { bikeId: null, status: 'RETIRED', retiredAt: now },
              });
            } else {
              await tx.component.update({
                where: { id: pairedInstall.componentId },
                data: { bikeId: null, status: 'INVENTORY', installedAt: null },
              });
            }
          }

          // Create new paired component
          const pairSpec = pairNewComponent || newComponent;
          if (pairSpec) {
            const newPairGroupId = createId();
            const pairedComponent = await tx.component.create({
              data: {
                type: slotType as ComponentTypeLiteral,
                location: pairedLocation as ComponentLocation,
                bikeId,
                userId,
                brand: pairSpec.brand,
                model: pairSpec.model,
                isStock: pairSpec.isStock ?? false,
                hoursUsed: 0,
                installedAt: now,
                baselineWearPercent: 0,
                baselineMethod: 'DEFAULT',
                baselineConfidence: 'HIGH',
                baselineSetAt: now,
                status: 'INSTALLED',
                pairGroupId: newPairGroupId,
              },
            });

            // Update the primary installed component with the pair group
            await tx.component.update({
              where: { id: componentToInstall.id },
              data: { pairGroupId: newPairGroupId },
            });

            await tx.bikeComponentInstall.create({
              data: {
                userId,
                bikeId,
                componentId: pairedComponent.id,
                slotKey: pairedSlotKey,
                installedAt: now,
              },
            });

            // Set replacedById chain for paired component
            if (pairedInstall) {
              await tx.component.update({
                where: { id: pairedInstall.componentId },
                data: { replacedById: pairedComponent.id },
              });
            }
          }
        }
      });

      // Invalidate prediction caches for all affected bikes
      for (const affectedBikeId of bikesToInvalidate) {
        await invalidateBikePrediction(userId, affectedBikeId);
      }

      return {
        installedComponent: installedComponent!,
        displacedComponent,
      };
    },

    swapComponents: async (
      _: unknown,
      { input }: { input: SwapComponentsInputGQL },
      ctx: GraphQLContext
    ) => {
      const userId = requireUserId(ctx);

      const rateLimit = await checkMutationRateLimit('swapComponents', userId);
      if (!rateLimit.allowed) {
        throw new GraphQLError(`Rate limit exceeded. Try again in ${rateLimit.retryAfter} seconds.`, {
          extensions: { code: 'RATE_LIMITED', retryAfter: rateLimit.retryAfter },
        });
      }

      const { bikeIdA, slotKeyA, bikeIdB, slotKeyB } = input;

      // Validate both bikes belong to user
      const [bikeA, bikeB] = await Promise.all([
        prisma.bike.findFirst({ where: { id: bikeIdA, userId } }),
        prisma.bike.findFirst({ where: { id: bikeIdB, userId } }),
      ]);
      if (!bikeA) {
        throw new GraphQLError('First bike not found', { extensions: { code: 'NOT_FOUND' } });
      }
      if (!bikeB) {
        throw new GraphQLError('Second bike not found', { extensions: { code: 'NOT_FOUND' } });
      }

      const { type: typeA } = parseSlotKey(slotKeyA);
      const { type: typeB } = parseSlotKey(slotKeyB);
      if (typeA !== typeB) {
        throw new GraphQLError('Cannot swap components of different types', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      let componentA: ComponentModel | null = null;
      let componentB: ComponentModel | null = null;

      await prisma.$transaction(async (tx) => {
        const now = new Date();

        // Find active installs for both slots
        const [installA, installB] = await Promise.all([
          tx.bikeComponentInstall.findFirst({ where: { bikeId: bikeIdA, slotKey: slotKeyA, removedAt: null } }),
          tx.bikeComponentInstall.findFirst({ where: { bikeId: bikeIdB, slotKey: slotKeyB, removedAt: null } }),
        ]);

        if (!installA) {
          throw new GraphQLError('No component installed in the first slot', {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }
        if (!installB) {
          throw new GraphQLError('No component installed in the second slot', {
            extensions: { code: 'BAD_USER_INPUT' },
          });
        }

        // Close both installs
        await Promise.all([
          tx.bikeComponentInstall.update({ where: { id: installA.id }, data: { removedAt: now } }),
          tx.bikeComponentInstall.update({ where: { id: installB.id }, data: { removedAt: now } }),
        ]);

        // Parse locations for the swap
        const { location: locationA } = parseSlotKey(slotKeyA);
        const { location: locationB } = parseSlotKey(slotKeyB);

        // Update component A → goes to bike B / slot B
        componentA = await tx.component.update({
          where: { id: installA.componentId },
          data: {
            bikeId: bikeIdB,
            location: locationB as ComponentLocation,
          },
        });

        // Update component B → goes to bike A / slot A
        componentB = await tx.component.update({
          where: { id: installB.componentId },
          data: {
            bikeId: bikeIdA,
            location: locationA as ComponentLocation,
          },
        });

        // Create new install records (A in slot B, B in slot A)
        await Promise.all([
          tx.bikeComponentInstall.create({
            data: {
              userId,
              bikeId: bikeIdB,
              componentId: installA.componentId,
              slotKey: slotKeyB,
              installedAt: now,
            },
          }),
          tx.bikeComponentInstall.create({
            data: {
              userId,
              bikeId: bikeIdA,
              componentId: installB.componentId,
              slotKey: slotKeyA,
              installedAt: now,
            },
          }),
        ]);
      });

      // Invalidate prediction caches for both bikes
      await Promise.all([
        invalidateBikePrediction(userId, bikeIdA),
        invalidateBikePrediction(userId, bikeIdB),
      ]);

      return {
        componentA: componentA!,
        componentB: componentB!,
      };
    },

    migratePairedComponents: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
      const userId = requireUserId(ctx);

      // Rate limit check
      const rateLimit = await checkMutationRateLimit('migratePairedComponents', userId);
      if (!rateLimit.allowed) {
        throw new GraphQLError(`Rate limit exceeded. Try again in ${rateLimit.retryAfter} seconds.`, {
          extensions: { code: 'RATE_LIMITED', retryAfter: rateLimit.retryAfter },
        });
      }

      // Idempotency check: if user already has any paired components, skip migration
      // This prevents race conditions when multiple tabs trigger migration simultaneously
      const existingPairedComponent = await prisma.component.findFirst({
        where: { userId, pairGroupId: { not: null } },
      });
      if (existingPairedComponent) {
        return { migratedCount: 0, components: [] };
      }

      // Find all paired-type components for this user with location=NONE (old format)
      const unpairedComponents = await prisma.component.findMany({
        where: {
          userId,
          type: { in: ['TIRES', 'BRAKE_PAD', 'BRAKE_ROTOR', 'BRAKES'] },
          location: 'NONE',
          retiredAt: null,
        },
      });

      if (unpairedComponents.length === 0) {
        return { migratedCount: 0, components: [] };
      }

      const allNewComponents: ComponentModel[] = [];
      const bikeIdsToInvalidate = new Set<string>();

      // Process each unpaired component with extended timeout
      await prisma.$transaction(
        async (tx) => {
          for (const component of unpairedComponents) {
            const pairGroupId = createId();

            // Update existing component to be FRONT with pairGroupId
            await tx.component.update({
              where: { id: component.id },
              data: {
                location: 'FRONT',
                pairGroupId,
              },
            });

            // Create REAR copy with same wear state
            const rearComponent = await tx.component.create({
              data: {
                type: component.type,
                brand: component.brand,
                model: component.model,
                location: 'REAR',
                pairGroupId,
                bikeId: component.bikeId,
                userId: component.userId,
                hoursUsed: component.hoursUsed,
                serviceIntervalHours: component.serviceIntervalHours,
                installedAt: component.installedAt,
                isStock: component.isStock,
                baselineWearPercent: component.baselineWearPercent,
                baselineMethod: component.baselineMethod,
                baselineConfidence: component.baselineConfidence,
                baselineSetAt: component.baselineSetAt,
                lastServicedAt: component.lastServicedAt,
              },
            });

            allNewComponents.push(rearComponent);

            // Collect bike IDs for cache invalidation (done outside transaction)
            if (component.bikeId) {
              bikeIdsToInvalidate.add(component.bikeId);
            }
          }
        },
        {
          timeout: 30000, // 30 seconds for large migrations
        }
      );

      // Invalidate prediction caches outside the transaction
      for (const bikeId of bikeIdsToInvalidate) {
        await invalidateBikePrediction(userId, bikeId);
      }

      // Refetch the updated FRONT components
      const updatedFrontComponents = await prisma.component.findMany({
        where: {
          id: { in: unpairedComponents.map((c) => c.id) },
        },
      });

      return {
        migratedCount: unpairedComponents.length,
        components: [...updatedFrontComponents, ...allNewComponents],
      };
    },
  },

  Bike: {
    components: (bike: Bike & { components?: ComponentModel[] }) => {
      if (bike.components) return bike.components;
      return prisma.component.findMany({ where: { bikeId: bike.id } });
    },
    fork: (bike: Bike & { components?: ComponentModel[] }) =>
      pickComponent(bike, ComponentTypeEnum.FORK),
    shock: (bike: Bike & { components?: ComponentModel[] }) =>
      pickComponent(bike, ComponentTypeEnum.SHOCK),
    seatpost: (bike: Bike & { components?: ComponentModel[] }) =>
      pickComponent(bike, ComponentTypeEnum.SEATPOST),
    wheels: (bike: Bike & { components?: ComponentModel[] }) =>
      pickComponent(bike, ComponentTypeEnum.WHEEL_HUBS),
    pivotBearings: (bike: Bike & { components?: ComponentModel[] }) =>
      pickComponent(bike, ComponentTypeEnum.PIVOT_BEARINGS),
    predictions: async (bike: Bike, _args: unknown, ctx: GraphQLContext) => {
      const userId = ctx.user?.id;
      if (!userId) return null;

      // Verify the bike belongs to the requesting user
      if (bike.userId !== userId) {
        throw new Error('Unauthorized');
      }

      // Note: No rate limit here - this is a field resolver called per-bike
      // in normal query flow. Rate limiting would block users with multiple bikes.

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, predictionMode: true },
      });

      if (!user) return null;

      try {
        const { generateBikePredictions } = await import('../services/prediction');
        const predictionMode = (user.predictionMode === 'predictive' ? 'predictive' : 'simple') as 'simple' | 'predictive';
        return generateBikePredictions({
          userId,
          bikeId: bike.id,
          userRole: user.role,
          predictionMode,
        });
      } catch (error) {
        logError('Resolver Prediction generation', error);
        return null;
      }
    },
    servicePreferences: async (bike: Bike & { servicePreferences?: unknown[] }) => {
      // Return pre-loaded preferences if available
      if (bike.servicePreferences) return bike.servicePreferences;
      // Otherwise fetch from database
      return prisma.bikeServicePreference.findMany({
        where: { bikeId: bike.id },
      });
    },
  },

  Component: {
    isSpare: (component: ComponentModel & { status?: string }) =>
      component.status === 'INVENTORY' || (component.status == null && component.bikeId == null),
    status: (component: ComponentModel & { status?: string }) => {
      if (component.status) return component.status;
      // Fallback for rows without status (pre-migration)
      if (component.retiredAt) return 'RETIRED';
      if (component.bikeId == null) return 'INVENTORY';
      return 'INSTALLED';
    },
    // Map legacy WHEELS database value to WHEEL_HUBS for GraphQL
    type: (component: ComponentModel & { type: string }) =>
      component.type === 'WHEELS' ? 'WHEEL_HUBS' : component.type,
    location: (component: ComponentModel & { location?: string }) =>
      component.location ?? 'NONE',
    serviceLogs: (component: ComponentModel, _args: unknown, ctx: GraphQLContext) =>
      ctx.loaders.serviceLogsByComponentId.load(component.id),
    pairedComponent: async (component: ComponentModel) => {
      if (!component.pairGroupId) return null;
      return prisma.component.findFirst({
        where: {
          pairGroupId: component.pairGroupId,
          id: { not: component.id },
          retiredAt: null,
        },
      });
    },
  },

  User: {
    activeDataSource: (parent: { activeDataSource: string | null }) => parent.activeDataSource,
    role: (parent: { role: string }) => parent.role,
    mustChangePassword: (parent: { mustChangePassword?: boolean }) => parent.mustChangePassword ?? false,
    accounts: async (parent: { id: string }) => {
      const accounts = await prisma.userAccount.findMany({
        where: { userId: parent.id },
        select: { provider: true, createdAt: true },
      });

      return accounts.map(acc => ({
        provider: acc.provider,
        connectedAt: acc.createdAt.toISOString(),
      }));
    },
    hasAcceptedCurrentTerms: async (parent: { id: string }) => {
      const acceptance = await prisma.termsAcceptance.findUnique({
        where: {
          userId_termsVersion: {
            userId: parent.id,
            termsVersion: CURRENT_TERMS_VERSION,
          },
        },
      });
      return !!acceptance;
    },
    pairedComponentMigrationSeenAt: (parent: { pairedComponentMigrationSeenAt?: Date | null }) =>
      parent.pairedComponentMigrationSeenAt?.toISOString() ?? null,
    createdAt: (parent: { createdAt: Date }) => parent.createdAt.toISOString(),
    servicePreferences: async (parent: { id: string }) => {
      return prisma.userServicePreference.findMany({
        where: { userId: parent.id },
      });
    },
  },
};
