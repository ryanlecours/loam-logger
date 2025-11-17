import type { GraphQLContext } from '../server.ts';
import { prisma } from '../lib/prisma.ts';
import { ComponentType as ComponentTypeEnum } from '@prisma/client';
import type {
  Prisma,
  ComponentType as ComponentTypeLiteral,
  Bike,
  Component as ComponentModel,
} from '@prisma/client';

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

type AddBikeInputGQL = {
  nickname?: string | null;
  manufacturer: string;
  model: string;
  year: number;
  travelForkMm?: number | null;
  travelShockMm?: number | null;
  notes?: string | null;
  fork?: BikeComponentInputGQL | null;
  shock?: BikeComponentInputGQL | null;
  dropper?: BikeComponentInputGQL | null;
  wheels?: BikeComponentInputGQL | null;
  pivotBearings?: BikeComponentInputGQL | null;
};

type UpdateBikeInputGQL = Partial<AddBikeInputGQL> & {
  year?: number | null;
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

type RidesArgs = { take?: number; after?: string | null };

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

    rides: async (_: unknown, { take = 20, after }: RidesArgs, ctx: GraphQLContext) => {
      if (!ctx.user?.id) throw new Error('Unauthorized');
      const limit = Math.min(100, Math.max(1, take));

      return prisma.ride.findMany({
        where: { userId: ctx.user.id },
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

      return prisma.$transaction(async (tx) => {
        const updated = await tx.ride.update({
          where: { id },
          data,
        });

        if (existing.bikeId && hoursBefore > 0) {
          await tx.component.updateMany({
            where: { userId, bikeId: existing.bikeId },
            data: { hoursUsed: { decrement: hoursBefore } },
          });
          await tx.component.updateMany({
            where: { userId, bikeId: existing.bikeId, hoursUsed: { lt: 0 } },
            data: { hoursUsed: 0 },
          });
        }

        if (nextBikeId && hoursAfter > 0) {
          await tx.component.updateMany({
            where: { userId, bikeId: nextBikeId },
            data: { hoursUsed: { increment: hoursAfter } },
          });
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
            userId,
          },
        });

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
};
