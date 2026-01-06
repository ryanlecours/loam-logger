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
import { checkRateLimit, checkMutationRateLimit } from '../lib/rate-limit';
import { enqueueSyncJob, type SyncProvider } from '../lib/queue';
import { invalidateBikePrediction } from '../services/prediction/cache';
import {
  getApplicableComponents,
  deriveBikeSpec,
  type BikeSpec,
  type SpokesComponents,
} from '@loam/shared';
import { logError } from '../lib/logger';
import type { AcquisitionCondition, BaselineMethod, BaselineConfidence } from '@prisma/client';
import { getBikeById, isSpokesConfigured } from '../services/spokes';
import { parseISO } from 'date-fns';

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
  dropper?: BikeComponentInputGQL | null;
  wheels?: BikeComponentInputGQL | null;
  pivotBearings?: BikeComponentInputGQL | null;
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
  WHEELS: 'Wheelset',
  PIVOT_BEARINGS: 'Pivot Bearings',
};

const REQUIRED_BIKE_COMPONENTS = [
  ['fork', ComponentTypeEnum.FORK],
  ['shock', ComponentTypeEnum.SHOCK],
  ['dropper', ComponentTypeEnum.DROPPER],
  ['wheels', ComponentTypeEnum.WHEELS],
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
    acquisitionCondition: AcquisitionCondition;
    spokesComponents?: SpokesComponentsInputGQL | null;
    userOverrides?: Partial<Record<BikeComponentKey, BikeComponentInputGQL | null>>;
  }
): Promise<void> {
  const { bikeId, userId, bikeSpec, acquisitionCondition, spokesComponents, userOverrides } = opts;

  // Determine baseline values based on acquisition condition
  const isNew = acquisitionCondition === 'NEW';
  const baselineWearPercent = isNew ? 0 : 50;
  const baselineMethod: BaselineMethod = 'DEFAULT';
  const baselineConfidence: BaselineConfidence = isNew ? 'HIGH' : 'LOW';
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
          dropper: 'DROPPER',
          wheels: 'WHEELS',
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

    // Determine brand/model
    let brand: string;
    let model: string;
    let notes: string | null = null;
    let isStock = true;

    if (override) {
      // User provided override
      const normalized = normalizeBikeComponentInput(type as ComponentType, override);
      brand = normalized.brand;
      model = normalized.model;
      notes = normalized.notes;
      isStock = normalized.isStock;
    } else if (spokesData?.maker && spokesData?.model) {
      // Use 99Spokes data
      brand = spokesData.maker;
      model = spokesData.model;
      notes = spokesData.description ?? null;
      isStock = true;
    } else {
      // Default stock component
      brand = 'Stock';
      model = displayName;
      isStock = true;
    }

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

  // Batch create all components
  // skipDuplicates handles race conditions where components may already exist
  if (componentsToCreate.length > 0) {
    await tx.component.createMany({
      data: componentsToCreate,
      skipDuplicates: true,
    });
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
        where.type = { in: filter.types };
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
        if (bikeId && hoursDelta > 0) {
          await tx.component.updateMany({
            where: { bikeId, userId },
            data: { hoursUsed: { increment: hoursDelta } },
          });
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
        if (ride.bikeId && hoursDelta > 0) {
          await tx.component.updateMany({
            where: { userId, bikeId: ride.bikeId },
            data: { hoursUsed: { decrement: hoursDelta } },
          });
          await tx.component.updateMany({
            where: { userId, bikeId: ride.bikeId, hoursUsed: { lt: 0 } },
            data: { hoursUsed: 0 },
          });
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
            if (bikeChanged && hoursBefore > 0) {
              await tx.component.updateMany({
                where: { userId, bikeId: existing.bikeId },
                data: { hoursUsed: { decrement: hoursBefore } },
              });
            } else if (!bikeChanged && durationChanged && hoursDiff < 0) {
              await tx.component.updateMany({
                where: { userId, bikeId: existing.bikeId },
                data: { hoursUsed: { decrement: Math.abs(hoursDiff) } },
              });
            }

            if (bikeChanged || (durationChanged && hoursDiff < 0)) {
              await tx.component.updateMany({
                where: { userId, bikeId: existing.bikeId, hoursUsed: { lt: 0 } },
                data: { hoursUsed: 0 },
              });
            }
          }

          // Add hours to the new/current bike when appropriate
          if (nextBikeId) {
            if (bikeChanged && hoursAfter > 0) {
              await tx.component.updateMany({
                where: { userId, bikeId: nextBikeId },
                data: { hoursUsed: { increment: hoursAfter } },
              });
            } else if (!bikeChanged && durationChanged && hoursDiff > 0) {
              await tx.component.updateMany({
                where: { userId, bikeId: nextBikeId },
                data: { hoursUsed: { increment: hoursDiff } },
              });
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

        // Build components dynamically based on BikeSpec and acquisition condition
        await buildBikeComponents(tx, {
          bikeId: bike.id,
          userId,
          bikeSpec,
          acquisitionCondition,
          spokesComponents: input.spokesComponents,
          userOverrides: {
            fork: input.fork,
            shock: input.shock,
            dropper: input.dropper,
            wheels: input.wheels,
            pivotBearings: input.pivotBearings,
          },
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
            dropper: input.dropper,
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
        return await prisma.component.create({
          data: {
            ...normalizeLooseComponentInput(type, input),
            type,
            location: input.location ?? 'NONE',
            bikeId: bikeId ?? null,
            userId,
            installedAt: new Date(),
          },
        });
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

          if (totalHours > 0) {
            await tx.component.updateMany({
              where: { userId, bikeId: input.bikeId },
              data: { hoursUsed: { increment: totalHours } },
            });
          }
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

        if (totalHours > 0) {
          await tx.component.updateMany({
            where: { userId, bikeId: mapping.bikeId },
            data: { hoursUsed: { decrement: totalHours } },
          });

          await tx.component.updateMany({
            where: { userId, bikeId: mapping.bikeId, hoursUsed: { lt: 0 } },
            data: { hoursUsed: 0 },
          });
        }

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
        // Validate lastServicedAt is not before bike creation
        if (update.lastServicedAt && component.bike?.createdAt) {
          const serviceDate = parseISO(update.lastServicedAt);
          if (!isNaN(serviceDate.getTime()) && serviceDate < component.bike.createdAt) {
            throw new Error('Service date cannot be before the bike was added');
          }
        }
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
    dropper: (bike: Bike & { components?: ComponentModel[] }) =>
      pickComponent(bike, ComponentTypeEnum.DROPPER),
    wheels: (bike: Bike & { components?: ComponentModel[] }) =>
      pickComponent(bike, ComponentTypeEnum.WHEELS),
    pivotBearings: (bike: Bike & { components?: ComponentModel[] }) =>
      pickComponent(bike, ComponentTypeEnum.PIVOT_BEARINGS),
    predictions: async (bike: Bike, _args: unknown, ctx: GraphQLContext) => {
      const userId = ctx.user?.id;
      if (!userId) return null;

      // Verify the bike belongs to the requesting user
      if (bike.userId !== userId) {
        throw new Error('Unauthorized');
      }

      // Rate limit prediction requests to prevent DoS
      const rateLimit = await checkMutationRateLimit('predictions', userId);
      if (!rateLimit.allowed) {
        throw new GraphQLError(`Rate limit exceeded. Try again in ${rateLimit.retryAfter} seconds.`, {
          extensions: { code: 'RATE_LIMITED', retryAfter: rateLimit.retryAfter },
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });

      if (!user) return null;

      try {
        const { generateBikePredictions } = await import('../services/prediction');
        return generateBikePredictions({
          userId,
          bikeId: bike.id,
          userRole: user.role,
        });
      } catch (error) {
        logError('Resolver Prediction generation', error);
        return null;
      }
    },
  },

  Component: {
    isSpare: (component: ComponentModel) => component.bikeId == null,
    location: (component: ComponentModel & { location?: string }) =>
      component.location ?? 'NONE',
    serviceLogs: (component: ComponentModel, _args: unknown, ctx: GraphQLContext) =>
      ctx.loaders.serviceLogsByComponentId.load(component.id),
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
  },
};
