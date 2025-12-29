import { GraphQLError } from 'graphql';
import type { GraphQLContext } from '../server';
import { prisma } from '../lib/prisma';
import { ComponentType as ComponentTypeEnum } from '@prisma/client';
import type {
  Prisma,
  ComponentType as ComponentTypeLiteral,
  Bike,
  Component as ComponentModel,
} from '@prisma/client';
import { checkRateLimit } from '../lib/rate-limit';
import { enqueueSyncJob, type SyncProvider } from '../lib/queue';

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

type BikeComponentInputGQL = {
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

type SpokesComponentsInputGQL = {
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
  spokesComponents?: SpokesComponentsInputGQL | null;
  fork?: BikeComponentInputGQL | null;
  shock?: BikeComponentInputGQL | null;
  dropper?: BikeComponentInputGQL | null;
  wheels?: BikeComponentInputGQL | null;
  pivotBearings?: BikeComponentInputGQL | null;
};

type UpdateBikeInputGQL = Partial<AddBikeInputGQL> & {
  year?: number | null;
};

// Mapping from 99spokes component keys to ComponentType
const SPOKES_TO_COMPONENT_TYPE: Record<string, ComponentType> = {
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

type AddComponentInputGQL = {
  type: ComponentType;
  brand?: string | null;
  model?: string | null;
  notes?: string | null;
  isStock?: boolean | null;
  hoursUsed?: number | null;
  serviceDueAtHours?: number | null;
};

type UpdateComponentInputGQL = Omit<AddComponentInputGQL, 'type'>;

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

type BikeComponentKey = (typeof REQUIRED_BIKE_COMPONENTS)[number][0];

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
        orderBy: { createdAt: 'desc' },
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

      return prisma.$transaction(async (tx) => {
        const ride = await tx.ride.create({ data: rideData });
        if (bikeId && hoursDelta > 0) {
          await tx.component.updateMany({
            where: { bikeId, userId },
            data: { hoursUsed: { increment: hoursDelta } },
          });
        }
        return ride;
      });
    },
    deleteRide: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      const userId = requireUserId(ctx);

      const ride = await prisma.ride.findUnique({
        where: { id },
        select: { userId: true, durationSeconds: true, bikeId: true },
      });
      if (!ride || ride.userId !== userId) {
        throw new Error('Ride not found');
      }

      const hoursDelta = Math.max(0, ride.durationSeconds ?? 0) / 3600;

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

      return { ok: true, id };
    },
    updateRide: async (
      _parent: unknown,
      { id, input }: { id: string; input: UpdateRideInput },
      ctx: GraphQLContext
    ) => {
      const userId = requireUserId(ctx);

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

      return prisma.$transaction(async (tx) => {
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
    },

    addBike: async (_: unknown, { input }: { input: AddBikeInputGQL }, ctx: GraphQLContext) => {
      const userId = requireUserId(ctx);

      const manufacturer = cleanText(input.manufacturer, MAX_LABEL_LEN);
      const model = cleanText(input.model, MAX_LABEL_LEN);
      if (!manufacturer) throw new Error('manufacturer is required');
      if (!model) throw new Error('model is required');

      const nickname = cleanText(input.nickname, MAX_LABEL_LEN);
      const year = clampYear(input.year);
      const travelForkMm = parseTravel(input.travelForkMm);
      const travelShockMm = parseTravel(input.travelShockMm);
      const notes = cleanText(input.notes, MAX_NOTES_LEN);
      const spokesId = cleanText(input.spokesId, 64);

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
            userId,
          },
        });

        // Sync the required bike components (fork, shock, dropper, wheels, pivotBearings)
        await syncBikeComponents(tx, {
          bikeId: bike.id,
          userId,
          components: {
            fork: input.fork,
            shock: input.shock,
            dropper: input.dropper,
            wheels: input.wheels,
            pivotBearings: input.pivotBearings,
          },
          createMissing: true,
        });

        // Auto-create components from 99spokes data
        if (input.spokesComponents) {
          const spokesComps = input.spokesComponents;
          for (const [key, compData] of Object.entries(spokesComps)) {
            if (!compData || !compData.maker || !compData.model) continue;

            let componentType = SPOKES_TO_COMPONENT_TYPE[key];
            if (!componentType) continue;

            // Skip types already handled by syncBikeComponents (FORK, SHOCK)
            // to avoid duplicates
            if (componentType === 'FORK' || componentType === 'SHOCK') continue;

            // Smart dropper detection: if seatpost.kind === 'dropper', create as DROPPER
            if (key === 'seatpost') {
              if (compData.kind === 'dropper') {
                componentType = 'DROPPER';
              } else {
                // It's a rigid seatpost, create as SEATPOST
                componentType = 'SEATPOST';
              }
            }

            // Check if component already exists for this bike
            const existing = await tx.component.findFirst({
              where: { bikeId: bike.id, type: componentType },
            });

            if (!existing) {
              await tx.component.create({
                data: {
                  type: componentType,
                  bikeId: bike.id,
                  userId,
                  brand: compData.maker,
                  model: compData.model,
                  notes: compData.description ?? null,
                  isStock: true,
                  hoursUsed: 0,
                  installedAt: new Date(),
                },
              });
            }
          }
        }

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

      return prisma.component.create({
        data: {
          ...normalizeLooseComponentInput(type, input),
          type,
          bikeId: bikeId ?? null,
          userId,
          installedAt: new Date(),
        },
      });
    },

    updateComponent: async (
      _: unknown,
      { id, input }: { id: string; input: UpdateComponentInputGQL },
      ctx: GraphQLContext
    ) => {
      const userId = requireUserId(ctx);
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

      return prisma.component.update({
        where: { id },
        data: normalized,
      });
    },

    deleteComponent: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      const userId = requireUserId(ctx);
      const existing = await prisma.component.findUnique({ where: { id }, select: { userId: true } });
      if (!existing || existing.userId !== userId) throw new Error('Component not found');
      await prisma.component.delete({ where: { id } });
      return { ok: true, id };
    },

    logComponentService: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      const userId = requireUserId(ctx);
      const existing = await prisma.component.findUnique({ where: { id }, select: { userId: true } });
      if (!existing || existing.userId !== userId) throw new Error('Component not found');

      return prisma.component.update({
        where: { id },
        data: { hoursUsed: 0 },
      });
    },

    createStravaGearMapping: async (
      _: unknown,
      { input }: { input: { stravaGearId: string; stravaGearName?: string | null; bikeId: string } },
      ctx: GraphQLContext
    ) => {
      const userId = requireUserId(ctx);

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

      return prisma.$transaction(async (tx) => {
        const mapping = await tx.stravaGearMapping.create({
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

        return mapping;
      });
    },

    deleteStravaGearMapping: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      const userId = requireUserId(ctx);
      const mapping = await prisma.stravaGearMapping.findUnique({
        where: { id },
        select: { userId: true, stravaGearId: true, bikeId: true },
      });
      if (!mapping || mapping.userId !== userId) {
        throw new Error('Mapping not found');
      }

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
  },

  Component: {
    isSpare: (component: ComponentModel) => component.bikeId == null,
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
