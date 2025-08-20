import type { GraphQLContext } from "../server.ts";
import { prisma } from "../lib/prisma.ts";
import type { BikeComponentType, Prisma } from "@prisma/client";

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

const REQUIRED_TYPES: BikeComponentType[] = [
  "FORK",
  "SHOCK",
  "WHEELSET",
  "DROPPERPOST",
] as const;

function hasAllTypes(types: BikeComponentType[]) {
  const set = new Set(types);
  return REQUIRED_TYPES.every((t) => set.has(t));
}

function parseIso(value: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime()))
    throw new Error("Invalid startTime; must be ISO 8601");
  return d;
}

async function isBikeComplete(bikeId: string) {
  const types = await prisma.bikeComponent.findMany({
    where: { bikeId },
    select: { type: true },
  });
  return hasAllTypes(types.map((t) => t.type));
}

async function accrueUsageHours(bikeId: string, hours: number) {
  if (hours === 0) return;
  // Only accrue if the bike is "complete"
  if (!(await isBikeComplete(bikeId))) return;

  await prisma.$transaction([
    prisma.bike.update({
      where: { id: bikeId },
      data: { pivotHoursSinceService: { increment: hours } },
    }),
    prisma.bikeComponent.updateMany({
      where: { bikeId },
      data: { hoursSinceService: { increment: hours } },
    }),
  ]);
}

/** If v is undefined => leave unchanged; if null => ignore (do not update); else parse. */
function parseIsoOptionalStrict(
  v: string | null | undefined
): Date | undefined {
  if (v == null) return undefined; // undefined means: do not include in update
  const d = new Date(v);
  if (Number.isNaN(d.getTime()))
    throw new Error("Invalid startTime; must be ISO 8601");
  return d;
}

const MAX_NOTES_LEN = 2000;

const MAX_LABEL_LEN = 120;

const cleanText = (v: unknown, max = MAX_LABEL_LEN) =>
  typeof v === "string" ? v.trim().slice(0, max) || null : null;

// ✅ Runtime list (must match your Prisma enum names exactly)
const ALLOWED_RIDE_TYPES = [
  "TRAIL",
  "ENDURO",
  "COMMUTE",
  "ROAD",
  "GRAVEL",
  "TRAINER",
] as const;

type RidesArgs = { take?: number; after?: string | null };

type AddBikeInput = {
  manufacturer: string;
  model: string;
  nickname?: string | null;
};

export const resolvers = {
  Bike: {
    components: (bike: any) =>
      prisma.bikeComponent.findMany({ where: { bikeId: bike.id } }),
    isComplete: async (bike: any) => {
      const types = await prisma.bikeComponent.findMany({
        where: { bikeId: bike.id },
        select: { type: true },
      });
      return hasAllTypes(types.map((t) => t.type));
    },
    createdAt: (b: any) =>
      b.createdAt instanceof Date ? b.createdAt.toISOString() : b.createdAt,
    updatedAt: (b: any) =>
      b.updatedAt instanceof Date ? b.updatedAt.toISOString() : b.updatedAt,
    pivotLastServicedAt: (b: any) =>
      b.pivotLastServicedAt instanceof Date
        ? b.pivotLastServicedAt.toISOString()
        : b.pivotLastServicedAt,
  },

  BikeComponent: {
    createdAt: (c: any) =>
      c.createdAt instanceof Date ? c.createdAt.toISOString() : c.createdAt,
    updatedAt: (c: any) =>
      c.updatedAt instanceof Date ? c.updatedAt.toISOString() : c.updatedAt,
    lastServicedAt: (c: any) =>
      c.lastServicedAt instanceof Date
        ? c.lastServicedAt.toISOString()
        : c.lastServicedAt,
  },
  Query: {
    user: (args: UserArgs) =>
      prisma.user.findUnique({
        where: { id: args.id },
        include: { rides: true },
      }),

    rides: async (
      _: unknown,
      { take = 20, after }: RidesArgs,
      ctx: GraphQLContext
    ) => {
      if (!ctx.user?.id) throw new Error("Unauthorized");
      const limit = Math.min(100, Math.max(1, take));

      return prisma.ride.findMany({
        where: { userId: ctx.user.id },
        orderBy: { startTime: "desc" },
        take: limit,
        ...(after ? { skip: 1, cursor: { id: after } } : {}),
      });
    },

    bikes: async (_p: unknown, _a: unknown, ctx: GraphQLContext) => {
      if (!ctx.user?.id) throw new Error("Unauthorized");
      return prisma.bike.findMany({
        where: { userId: ctx.user.id },
        orderBy: [{ manufacturer: "asc" }, { model: "asc" }],
      });
    },
    bike: async (_p: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      if (!ctx.user?.id) throw new Error("Unauthorized");
      const owned = await prisma.bike.findFirst({
        where: { id, userId: ctx.user.id },
      });
      return owned ?? null;
    },

    rideTypes: () => ALLOWED_RIDE_TYPES,

    me: async (ctx: GraphQLContext) => {
      const id = ctx.user?.id;
      return id ? prisma.user.findUnique({ where: { id } }) : null;
    },
  },
  Mutation: {
    addRide: async (
      _p: unknown,
      { input }: { input: AddRideInput },
      ctx: GraphQLContext
    ) => {
      if (!ctx.user?.id) throw new Error("Unauthorized");

      const start = parseIso(input.startTime);
      const durationSeconds = Math.max(0, Math.floor(input.durationSeconds));
      const distanceMiles = Math.max(0, Number(input.distanceMiles));
      const elevationGainFeet = Math.max(0, Number(input.elevationGainFeet));
      const averageHr =
        typeof input.averageHr === "number"
          ? Math.max(0, Math.floor(input.averageHr))
          : null;

      const notes = cleanText(input.notes, MAX_NOTES_LEN);
      const trailSystem = cleanText(input.trailSystem, MAX_LABEL_LEN);
      const location = cleanText(input.location, MAX_LABEL_LEN);
      const rideType = cleanText(input.rideType, 32); // required; validated below

      if (!rideType) throw new Error("rideType is required");

      const ride = await prisma.ride.create({
        data: {
          userId: ctx.user.id,
          bikeId: input.bikeId ?? null,
          startTime: start,
          durationSeconds,
          distanceMiles,
          elevationGainFeet,
          averageHr,
          rideType,
          ...(input.bikeId ? { bikeId: input.bikeId } : {}),
          ...(notes ? { notes } : {}),
          ...(trailSystem ? { trailSystem } : {}),
          ...(location ? { location } : {}),
        },
      });
      if (ride.bikeId) {
        const hours = (ride.durationSeconds ?? 0) / 3600;
        await accrueUsageHours(ride.bikeId, hours);
      }
      return ride;
    },
    deleteRide: async (
      _: unknown,
      { id }: { id: string },
      ctx: GraphQLContext
    ) => {
      if (!ctx.user?.id) throw new Error("Unauthorized");

      // Ensure the ride belongs to the current user
      const owned = await prisma.ride.findUnique({
        where: { id },
        select: { userId: true },
      });
      if (!owned || owned.userId !== ctx.user.id) {
        // Hide whether it exists
        throw new Error("Ride not found");
      }

      await prisma.ride.delete({ where: { id } });
      return { ok: true, id };
    },
    updateRide: async (
  _parent: unknown,
  { id, input }: { id: string; input: UpdateRideInput },
  ctx: GraphQLContext
) => {
  if (!ctx.user?.id) throw new Error('Unauthorized');

  // Fetch the existing ride for ownership + old values (duration, bike)
  const existing = await prisma.ride.findUnique({
    where: { id },
    select: { userId: true, durationSeconds: true, bikeId: true },
  });
  if (!existing || existing.userId !== ctx.user.id) throw new Error('Ride not found');

  // Build a strongly-typed update object
  const start = parseIsoOptionalStrict(input.startTime);

  const rideType =
    input.rideType === undefined ? undefined : cleanText(input.rideType, 32) || undefined;

  const notes =
    'notes' in input
      ? typeof input.notes === 'string'
        ? cleanText(input.notes, MAX_NOTES_LEN)
        : null
      : undefined;

  const trailSystem =
    'trailSystem' in input
      ? typeof input.trailSystem === 'string'
        ? cleanText(input.trailSystem, MAX_LABEL_LEN)
        : null
      : undefined;

  const location =
    'location' in input
      ? typeof input.location === 'string'
        ? cleanText(input.location, MAX_LABEL_LEN)
        : null
      : undefined;

  const data: Prisma.RideUpdateInput = {
    ...(start !== undefined && { startTime: start }),
    ...(input.durationSeconds !== undefined && {
      durationSeconds: Math.max(0, Math.floor(input.durationSeconds ?? 0)),
    }),
    ...(input.distanceMiles !== undefined && {
      distanceMiles: Math.max(0, Number(input.distanceMiles ?? 0)),
    }),
    ...(input.elevationGainFeet !== undefined && {
      elevationGainFeet: Math.max(0, Number(input.elevationGainFeet ?? 0)),
    }),
    ...(input.averageHr !== undefined && {
      averageHr:
        input.averageHr == null ? null : Math.max(0, Math.floor(input.averageHr)),
    }),
    ...(rideType !== undefined && { rideType }),
    ...(input.bikeId !== undefined && { bikeId: input.bikeId ?? null }),
    ...('notes' in input ? { notes: notes as string | null } : {}),
    ...('trailSystem' in input ? { trailSystem: trailSystem as string | null } : {}),
    ...('location' in input ? { location: location as string | null } : {}),
  };

  // Update the ride first, then accrue hours based on deltas / bike changes
  const updated = await prisma.ride.update({
    where: { id },
    data,
  });

  // Compute hours (in hours) before/after
  const oldHours = (existing.durationSeconds ?? 0) / 3600;
  const newHours = (updated.durationSeconds ?? 0) / 3600;

  if (existing.bikeId === updated.bikeId) {
    // Same bike: only accrue the delta
    const delta = newHours - oldHours;
    if (updated.bikeId && delta !== 0) {
      await accrueUsageHours(updated.bikeId, delta);
    }
  } else {
    // Bike changed: remove from old, add to new
    if (existing.bikeId && oldHours !== 0) {
      await accrueUsageHours(existing.bikeId, -oldHours);
    }
    if (updated.bikeId && newHours !== 0) {
      await accrueUsageHours(updated.bikeId, newHours);
    }
  }

  return updated;
},
    addBike: async (
      _: unknown,
      { input }: { input: AddBikeInput },
      ctx: GraphQLContext
    ) => {
      if (!ctx.user?.id) throw new Error("Unauthorized");
      const manufacturer = input.manufacturer.trim();
      const model = input.model.trim();
      const nickname = input.nickname?.trim() || null;
      if (!manufacturer || !model)
        throw new Error("manufacturer and model are required");
      return prisma.bike.create({
        data: { userId: ctx.user.id, manufacturer, model, nickname },
      });
    },
    upsertBikeComponent: async (
      _p: unknown,
      {
        input,
      }: {
        input: {
          bikeId: string;
          type: BikeComponentType;
          manufacturer: string;
          model: string;
          year?: number | null;
        };
      },
      ctx: GraphQLContext
    ) => {
      if (!ctx.user?.id) throw new Error("Unauthorized");

      // Ownership check
      const bike = await prisma.bike.findFirst({
        where: { id: input.bikeId, userId: ctx.user.id },
        select: { id: true },
      });
      if (!bike) throw new Error("Bike not found");

      const data = {
        bikeId: input.bikeId,
        type: input.type,
        manufacturer: input.manufacturer.trim(),
        model: input.model.trim(),
        year: input.year ?? null,
      };

      // Unique by (bikeId, type)
      return prisma.bikeComponent.upsert({
        where: { bikeId_type: { bikeId: input.bikeId, type: input.type } },
        update: data,
        create: data,
      });
    },

    markBikePivotServiced: async (
      _p: unknown,
      { bikeId }: { bikeId: string },
      ctx: GraphQLContext
    ) => {
      if (!ctx.user?.id) throw new Error("Unauthorized");
      return prisma.bike.update({
        where: { id: bikeId, userId: ctx.user.id },
        data: { pivotHoursSinceService: 0, pivotLastServicedAt: new Date() },
      });
    },

    markComponentServiced: async (
      _p: unknown,
      { componentId }: { componentId: string },
      ctx: GraphQLContext
    ) => {
      if (!ctx.user?.id) throw new Error("Unauthorized");
      // ownership via join
      const comp = await prisma.bikeComponent.findFirst({
        where: { id: componentId, bike: { userId: ctx.user.id } },
        select: { id: true },
      });
      if (!comp) throw new Error("Component not found");
      return prisma.bikeComponent.update({
        where: { id: componentId },
        data: { hoursSinceService: 0, lastServicedAt: new Date() },
      });
    },
  },
};
