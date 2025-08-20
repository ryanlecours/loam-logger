import type { GraphQLContext } from '../server.ts';
import { prisma } from '../lib/prisma.ts'

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

function parseIso(value: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid startTime; must be ISO 8601');
  return d;
}

function parseIsoOptional(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid startTime; must be ISO 8601');
  return d;
}

const MAX_NOTES_LEN = 2000;

const MAX_LABEL_LEN = 120;

const cleanText = (v: unknown, max = MAX_LABEL_LEN) =>
  typeof v === 'string' ? (v.trim().slice(0, max) || null) : null;

// ✅ Runtime list (must match your Prisma enum names exactly)
const ALLOWED_RIDE_TYPES = [
  'TRAIL',
  'ENDURO',
  'COMMUTE',
  'ROAD',
  'GRAVEL',
  'TRAINER',
] as const

type RidesArgs = { take?: number; after?: string | null };

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

    me: async (ctx: GraphQLContext) => {
      const id = ctx.user?.id;
      return id ? prisma.user.findUnique({ where: { id } }) : null;
    },
  },
   Mutation: {
    addRide: async (_p: unknown, { input }: { input: AddRideInput }, ctx: GraphQLContext) => {
      if (!ctx.user?.id) throw new Error('Unauthorized');

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

      if (!rideType) throw new Error('rideType is required');

      return prisma.ride.create({
        data: {
          userId: ctx.user.id,
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
    },
    deleteRide: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) => {
      if (!ctx.user?.id) throw new Error('Unauthorized');

      // Ensure the ride belongs to the current user
      const owned = await prisma.ride.findUnique({
        where: { id },
        select: { userId: true },
      });
      if (!owned || owned.userId !== ctx.user.id) {
        // Hide whether it exists
        throw new Error('Ride not found');
      }

      await prisma.ride.delete({ where: { id } });
      return { ok: true, id };
    },
    updateRide: async (
      _p: unknown,
      { id, input }: { id: string; input: UpdateRideInput },
      ctx: GraphQLContext
    ) => {
      if (!ctx.user?.id) throw new Error('Unauthorized');

      // ownership check (and existence)
      const owned = await prisma.ride.findUnique({
        where: { id },
        select: { userId: true },
      });
      if (!owned || owned.userId !== ctx.user.id) throw new Error('Ride not found');

      const data: Record<string, any> = {};

      const start = parseIsoOptional(input.startTime);
      if (start !== undefined) data.startTime = start;

      if (input.durationSeconds !== undefined)
        data.durationSeconds = Math.max(0, Math.floor(input.durationSeconds ?? 0));

      if (input.distanceMiles !== undefined)
        data.distanceMiles = Math.max(0, Number(input.distanceMiles ?? 0));

      if (input.elevationGainFeet !== undefined)
        data.elevationGainFeet = Math.max(0, Number(input.elevationGainFeet ?? 0));

      if (input.averageHr !== undefined)
        data.averageHr =
          input.averageHr == null ? null : Math.max(0, Math.floor(input.averageHr));

      if (input.rideType !== undefined) {
        const rt = cleanText(input.rideType, 32);
        data.rideType = rt ?? null;
      }

      if (input.bikeId !== undefined) data.bikeId = input.bikeId ?? null;

      if ('notes' in input) {
        const n = cleanText(input.notes, MAX_NOTES_LEN);
        data.notes = n ?? null;
      }
      if ('trailSystem' in input) {
        const ts = cleanText(input.trailSystem, MAX_LABEL_LEN);
        data.trailSystem = ts ?? null;
      }
      if ('location' in input) {
        const loc = cleanText(input.location, MAX_LABEL_LEN);
        data.location = loc ?? null;
      }

      const updated = await prisma.ride.update({
        where: { id },
        data,
      });

      return updated;
    },
  },
};
