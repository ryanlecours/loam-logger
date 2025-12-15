"use strict";
require("dotenv/config");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const server = require("@apollo/server");
const express4 = require("@as-integrations/express4");
const graphqlTag = require("graphql-tag");
const client$1 = require("@prisma/client");
const dateFns = require("date-fns");
const googleAuthLibrary = require("google-auth-library");
const jwt = require("jsonwebtoken");
const bcryptjs = require("bcryptjs");
const typeDefs = graphqlTag.gql`

  enum RideType {
    TRAIL
    ENDURO
    COMMUTE
    ROAD
    GRAVEL
    TRAINER
  }

  enum ComponentType {
    FORK
    SHOCK
    BRAKES
    DRIVETRAIN
    TIRES
    WHEELS
    DROPPER
    PEDALS
    CHAIN
    CASSETTE
    OTHER
    PIVOT_BEARINGS
  }

  type Ride {
    id: ID!
    userId: ID!
    garminActivityId: String
    stravaActivityId: String
    stravaGearId: String
    startTime: String!
    durationSeconds: Int!
    distanceMiles: Float!
    elevationGainFeet: Float!
    averageHr: Int
    rideType: String!
    bikeId: ID
    notes: String
    trailSystem: String
    location: String
    createdAt: String!
    updatedAt: String!
  }

  type Component {
    id: ID!
    type: ComponentType!
    brand: String!
    model: String!
    installedAt: String
    hoursUsed: Float!
    serviceDueAtHours: Float
    notes: String
    isStock: Boolean!
    bikeId: ID
    isSpare: Boolean!
    createdAt: String!
    updatedAt: String!
  }

  type Bike {
    id: ID!
    nickname: String
    manufacturer: String!
    model: String!
    year: Int
    travelForkMm: Int
    travelShockMm: Int
    notes: String
    fork: Component
    shock: Component
    dropper: Component
    wheels: Component
    pivotBearings: Component
    components: [Component!]!
    createdAt: String!
    updatedAt: String!
  }

  type StravaGearMapping {
    id: ID!
    stravaGearId: String!
    stravaGearName: String
    bikeId: ID!
    bike: Bike!
    createdAt: String!
  }

  type StravaGearInfo {
    gearId: String!
    gearName: String
    rideCount: Int!
    isMapped: Boolean!
  }

  input CreateStravaGearMappingInput {
    stravaGearId: String!
    stravaGearName: String
    bikeId: ID!
  }

  input UpdateRideInput {
    startTime: String
    durationSeconds: Int
    distanceMiles: Float
    elevationGainFeet: Float
    averageHr: Int
    rideType: String
    bikeId: ID
    notes: String
    trailSystem: String
    location: String
  }

  input AddRideInput {
    startTime: String!
    durationSeconds: Int!
    distanceMiles: Float!
    elevationGainFeet: Float!
    averageHr: Int
    rideType: String!
    bikeId: ID
    notes: String
    trailSystem: String
    location: String
  }

  type DeleteRideResult { ok: Boolean!, id: ID! }

  input BikeComponentInput {
    brand: String
    model: String
    notes: String
    isStock: Boolean
  }

  input AddBikeInput {
    nickname: String
    manufacturer: String!
    model: String!
    year: Int!
    travelForkMm: Int
    travelShockMm: Int
    notes: String
    fork: BikeComponentInput
    shock: BikeComponentInput
    dropper: BikeComponentInput
    wheels: BikeComponentInput
    pivotBearings: BikeComponentInput
  }

  input UpdateBikeInput {
    nickname: String
    manufacturer: String
    model: String
    year: Int
    travelForkMm: Int
    travelShockMm: Int
    notes: String
    fork: BikeComponentInput
    shock: BikeComponentInput
    dropper: BikeComponentInput
    wheels: BikeComponentInput
    pivotBearings: BikeComponentInput
  }

  input AddComponentInput {
    type: ComponentType!
    brand: String
    model: String
    notes: String
    isStock: Boolean
    hoursUsed: Float
    serviceDueAtHours: Float
  }

  input UpdateComponentInput {
    brand: String
    model: String
    notes: String
    isStock: Boolean
    hoursUsed: Float
    serviceDueAtHours: Float
  }

  input ComponentFilterInput {
    bikeId: ID
    onlySpare: Boolean
    types: [ComponentType!]
  }

  type DeleteResult {
    ok: Boolean!
    id: ID!
  }

  type Mutation {
    addRide(input: AddRideInput!): Ride!
    updateRide(id: ID!, input: UpdateRideInput!): Ride!
    deleteRide(id: ID!): DeleteRideResult!
    addBike(input: AddBikeInput!): Bike!
    updateBike(id: ID!, input: UpdateBikeInput!): Bike!
    addComponent(input: AddComponentInput!, bikeId: ID): Component!
    updateComponent(id: ID!, input: UpdateComponentInput!): Component!
    deleteComponent(id: ID!): DeleteResult!
    logComponentService(id: ID!): Component!
    createStravaGearMapping(input: CreateStravaGearMappingInput!): StravaGearMapping!
    deleteStravaGearMapping(id: ID!): DeleteResult!
  }

  type ConnectedAccount {
    provider: String!
    connectedAt: String!
  }

  type User {
    id: ID!
    email: String!
    rides: [Ride!]!
    name: String
    avatarUrl: String
    onboardingCompleted: Boolean!
    location: String
    age: Int
    activeDataSource: String
    accounts: [ConnectedAccount!]!
  }

  input RidesFilterInput {
    startDate: String
    endDate: String
  }

  type Query {
    me: User
    user(id: ID!): User
    rides(take: Int = 1000, after: ID, filter: RidesFilterInput): [Ride!]!
    rideTypes: [RideType!]!
    bikes: [Bike!]!
    components(filter: ComponentFilterInput): [Component!]!
    stravaGearMappings: [StravaGearMapping!]!
    unmappedStravaGears: [StravaGearInfo!]!
  }
`;
const prisma = global.__prisma__ ?? new client$1.PrismaClient();
if (process.env.NODE_ENV !== "production") global.__prisma__ = prisma;
function parseIso(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid startTime; must be ISO 8601");
  return d;
}
function parseIsoOptionalStrict(v) {
  if (v == null) return void 0;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid startTime; must be ISO 8601");
  return d;
}
const MAX_NOTES_LEN = 2e3;
const MAX_LABEL_LEN = 120;
const cleanText = (v, max = MAX_LABEL_LEN) => typeof v === "string" ? v.trim().slice(0, max) || null : null;
const componentLabelMap = {
  FORK: "Fork",
  SHOCK: "Shock",
  DROPPER: "Dropper Post",
  WHEELS: "Wheelset",
  PIVOT_BEARINGS: "Pivot Bearings"
};
const REQUIRED_BIKE_COMPONENTS = [
  ["fork", client$1.ComponentType.FORK],
  ["shock", client$1.ComponentType.SHOCK],
  ["dropper", client$1.ComponentType.DROPPER],
  ["wheels", client$1.ComponentType.WHEELS],
  ["pivotBearings", client$1.ComponentType.PIVOT_BEARINGS]
];
const nowIsoYear = () => (/* @__PURE__ */ new Date()).getFullYear();
const clampYear = (value) => {
  if (value == null || Number.isNaN(value)) return nowIsoYear();
  const yr = Math.floor(value);
  return Math.min(nowIsoYear() + 1, Math.max(1980, yr));
};
const parseTravel = (value) => value == null || Number.isNaN(value) ? void 0 : Math.max(0, Math.floor(value));
const componentLabel = (type) => componentLabelMap[type] ?? type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const requireUserId = (ctx) => {
  const id = ctx.user?.id;
  if (!id) throw new Error("Unauthorized");
  return id;
};
const normalizeBikeComponentInput = (type, input) => {
  const fallback = componentLabel(type);
  const brand = input && input.brand !== void 0 ? cleanText(input.brand, MAX_LABEL_LEN) : void 0;
  const model = input && input.model !== void 0 ? cleanText(input.model, MAX_LABEL_LEN) : void 0;
  const notes = input && input.notes !== void 0 ? cleanText(input.notes, MAX_NOTES_LEN) : null;
  const inferredStock = !brand && !model;
  const isStock = input?.isStock ?? inferredStock ?? false;
  return {
    brand: brand ?? (isStock ? "Stock" : fallback),
    model: model ?? (isStock ? "Stock" : fallback),
    notes,
    isStock
  };
};
async function syncBikeComponents(tx, opts) {
  for (const [key, type] of REQUIRED_BIKE_COMPONENTS) {
    const incoming = opts.components?.[key];
    if (!incoming && !opts.createMissing) continue;
    const normalized = normalizeBikeComponentInput(type, incoming);
    const existing = await tx.component.findFirst({
      where: { bikeId: opts.bikeId, type }
    });
    if (existing) {
      if (!incoming && !opts.createMissing) continue;
      await tx.component.update({
        where: { id: existing.id },
        data: {
          brand: normalized.brand,
          model: normalized.model,
          notes: normalized.notes,
          isStock: normalized.isStock
        }
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
          installedAt: /* @__PURE__ */ new Date()
        }
      });
    }
  }
}
const normalizeLooseComponentInput = (type, input, base) => {
  const fallback = componentLabel(type);
  const defaults = base ?? {
    brand: fallback,
    model: fallback,
    notes: null,
    isStock: Boolean(input.isStock ?? true),
    hoursUsed: 0,
    serviceDueAtHours: null
  };
  const brand = input.brand !== void 0 ? cleanText(input.brand, MAX_LABEL_LEN) ?? "Stock" : void 0;
  const model = input.model !== void 0 ? cleanText(input.model, MAX_LABEL_LEN) ?? "Stock" : void 0;
  const notes = input.notes !== void 0 ? cleanText(input.notes, MAX_NOTES_LEN) : void 0;
  const isStock = input.isStock !== void 0 ? Boolean(input.isStock) : defaults.isStock ?? false;
  const hoursUsed = input.hoursUsed !== void 0 ? Math.max(0, Number(input.hoursUsed ?? 0)) : defaults.hoursUsed ?? 0;
  const serviceDueAtHours = input.serviceDueAtHours !== void 0 ? input.serviceDueAtHours == null ? null : Math.max(0, Number(input.serviceDueAtHours)) : defaults.serviceDueAtHours ?? null;
  return {
    brand: brand ?? defaults.brand ?? fallback,
    model: model ?? defaults.model ?? fallback,
    notes: notes !== void 0 ? notes : defaults.notes ?? null,
    isStock,
    hoursUsed,
    serviceDueAtHours
  };
};
const ALLOWED_RIDE_TYPES = [
  "TRAIL",
  "ENDURO",
  "COMMUTE",
  "ROAD",
  "GRAVEL",
  "TRAINER"
];
const pickComponent = (bike, type) => {
  if (bike.components) return bike.components.find((c) => c.type === type) ?? null;
  return prisma.component.findFirst({ where: { bikeId: bike.id, type } });
};
const resolvers = {
  Query: {
    user: (args) => prisma.user.findUnique({
      where: { id: args.id },
      include: { rides: true }
    }),
    rides: async (_, { take = 1e3, after, filter }, ctx) => {
      if (!ctx.user?.id) throw new Error("Unauthorized");
      const limit = Math.min(1e4, Math.max(1, take));
      const whereClause = {
        userId: ctx.user.id
      };
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
        orderBy: { startTime: "desc" },
        take: limit,
        ...after ? { skip: 1, cursor: { id: after } } : {}
      });
    },
    rideTypes: () => ALLOWED_RIDE_TYPES,
    me: async (_, _args, ctx) => {
      const id = ctx.user?.id;
      return id ? prisma.user.findUnique({ where: { id } }) : null;
    },
    bikes: async (_, __, ctx) => {
      const userId = requireUserId(ctx);
      return prisma.bike.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        include: { components: true }
      });
    },
    components: async (_, args, ctx) => {
      const userId = requireUserId(ctx);
      const filter = args.filter ?? {};
      const where = { userId };
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
        orderBy: { createdAt: "desc" }
      });
    },
    stravaGearMappings: async (_, __, ctx) => {
      const userId = requireUserId(ctx);
      return prisma.stravaGearMapping.findMany({
        where: { userId },
        include: { bike: true },
        orderBy: { createdAt: "desc" }
      });
    },
    unmappedStravaGears: async (_, __, ctx) => {
      const userId = requireUserId(ctx);
      const rides = await prisma.ride.findMany({
        where: { userId, stravaGearId: { not: null } },
        select: { stravaGearId: true }
      });
      const gearCounts = /* @__PURE__ */ new Map();
      rides.forEach((ride) => {
        if (ride.stravaGearId) {
          gearCounts.set(ride.stravaGearId, (gearCounts.get(ride.stravaGearId) || 0) + 1);
        }
      });
      const mappings = await prisma.stravaGearMapping.findMany({
        where: { userId },
        select: { stravaGearId: true }
      });
      const mappedGearIds = new Set(mappings.map((m) => m.stravaGearId));
      const result = [];
      gearCounts.forEach((count, gearId) => {
        result.push({
          gearId,
          gearName: null,
          rideCount: count,
          isMapped: mappedGearIds.has(gearId)
        });
      });
      return result.filter((g) => !g.isMapped);
    }
  },
  Mutation: {
    addRide: async (_p, { input }, ctx) => {
      if (!ctx.user?.id) throw new Error("Unauthorized");
      const userId = ctx.user.id;
      const start = parseIso(input.startTime);
      const durationSeconds = Math.max(0, Math.floor(input.durationSeconds));
      const distanceMiles = Math.max(0, Number(input.distanceMiles));
      const elevationGainFeet = Math.max(0, Number(input.elevationGainFeet));
      const averageHr = typeof input.averageHr === "number" ? Math.max(0, Math.floor(input.averageHr)) : null;
      const notes = cleanText(input.notes, MAX_NOTES_LEN);
      const trailSystem = cleanText(input.trailSystem, MAX_LABEL_LEN);
      const location = cleanText(input.location, MAX_LABEL_LEN);
      const rideType = cleanText(input.rideType, 32);
      const requestedBikeId = input.bikeId ?? null;
      if (!rideType) throw new Error("rideType is required");
      let bikeId = null;
      if (requestedBikeId) {
        const ownedBike = await prisma.bike.findUnique({
          where: { id: requestedBikeId },
          select: { userId: true }
        });
        if (!ownedBike || ownedBike.userId !== userId) throw new Error("Bike not found");
        bikeId = requestedBikeId;
      } else {
        const userBikes = await prisma.bike.findMany({
          where: { userId },
          select: { id: true }
        });
        if (userBikes.length === 1) {
          bikeId = userBikes[0].id;
        }
      }
      const rideData = {
        userId,
        startTime: start,
        durationSeconds,
        distanceMiles,
        elevationGainFeet,
        averageHr,
        rideType,
        ...bikeId ? { bikeId } : {},
        ...notes ? { notes } : {},
        ...trailSystem ? { trailSystem } : {},
        ...location ? { location } : {}
      };
      const hoursDelta = durationSeconds / 3600;
      return prisma.$transaction(async (tx) => {
        const ride = await tx.ride.create({ data: rideData });
        if (bikeId && hoursDelta > 0) {
          await tx.component.updateMany({
            where: { bikeId, userId },
            data: { hoursUsed: { increment: hoursDelta } }
          });
        }
        return ride;
      });
    },
    deleteRide: async (_, { id }, ctx) => {
      const userId = requireUserId(ctx);
      const ride = await prisma.ride.findUnique({
        where: { id },
        select: { userId: true, durationSeconds: true, bikeId: true }
      });
      if (!ride || ride.userId !== userId) {
        throw new Error("Ride not found");
      }
      const hoursDelta = Math.max(0, ride.durationSeconds ?? 0) / 3600;
      await prisma.$transaction(async (tx) => {
        if (ride.bikeId && hoursDelta > 0) {
          await tx.component.updateMany({
            where: { userId, bikeId: ride.bikeId },
            data: { hoursUsed: { decrement: hoursDelta } }
          });
          await tx.component.updateMany({
            where: { userId, bikeId: ride.bikeId, hoursUsed: { lt: 0 } },
            data: { hoursUsed: 0 }
          });
        }
        await tx.ride.delete({ where: { id } });
      });
      return { ok: true, id };
    },
    updateRide: async (_parent, { id, input }, ctx) => {
      const userId = requireUserId(ctx);
      const existing = await prisma.ride.findUnique({
        where: { id },
        select: { userId: true, durationSeconds: true, bikeId: true }
      });
      if (!existing || existing.userId !== userId) throw new Error("Ride not found");
      const start = parseIsoOptionalStrict(input.startTime);
      const rideType = input.rideType === void 0 ? void 0 : cleanText(input.rideType, 32) || void 0;
      const notes = input.notes !== void 0 ? typeof input.notes === "string" ? cleanText(input.notes, MAX_NOTES_LEN) : null : void 0;
      const trailSystem = input.trailSystem !== void 0 ? typeof input.trailSystem === "string" ? cleanText(input.trailSystem, MAX_LABEL_LEN) : null : void 0;
      const location = input.location !== void 0 ? typeof input.location === "string" ? cleanText(input.location, MAX_LABEL_LEN) : null : void 0;
      let nextDurationSeconds = existing.durationSeconds;
      let durationUpdate;
      if (input.durationSeconds !== void 0) {
        durationUpdate = Math.max(0, Math.floor(input.durationSeconds ?? 0));
        nextDurationSeconds = durationUpdate;
      }
      let nextBikeId = existing.bikeId ?? null;
      let bikeUpdate = void 0;
      if (input.bikeId !== void 0) {
        if (input.bikeId) {
          const ownedBike = await prisma.bike.findUnique({
            where: { id: input.bikeId },
            select: { userId: true }
          });
          if (!ownedBike || ownedBike.userId !== userId) throw new Error("Bike not found");
          bikeUpdate = input.bikeId;
          nextBikeId = input.bikeId;
        } else {
          bikeUpdate = null;
          nextBikeId = null;
        }
      }
      const data = {
        ...start !== void 0 && { startTime: start },
        // Date (no null)
        ...durationUpdate !== void 0 && {
          durationSeconds: durationUpdate
          // number (no null)
        },
        ...input.distanceMiles !== void 0 && {
          distanceMiles: Math.max(0, Number(input.distanceMiles ?? 0))
          // number (no null)
        },
        ...input.elevationGainFeet !== void 0 && {
          elevationGainFeet: Math.max(0, Number(input.elevationGainFeet ?? 0))
          // number (no null)
        },
        ...input.averageHr !== void 0 && {
          averageHr: input.averageHr == null ? null : Math.max(0, Math.floor(input.averageHr))
        },
        ...rideType !== void 0 && { rideType },
        // string only; omit if empty/undefined
        ...bikeUpdate !== void 0 && { bikeId: bikeUpdate },
        // nullable
        ...notes !== void 0 ? { notes } : {},
        ...trailSystem !== void 0 ? { trailSystem } : {},
        ...location !== void 0 ? { location } : {}
      };
      const hoursBefore = Math.max(0, existing.durationSeconds ?? 0) / 3600;
      const hoursAfter = Math.max(0, nextDurationSeconds ?? 0) / 3600;
      const hoursDiff = hoursAfter - hoursBefore;
      const durationChanged = durationUpdate !== void 0;
      const bikeChanged = bikeUpdate !== void 0 && nextBikeId !== existing.bikeId;
      return prisma.$transaction(async (tx) => {
        const updated = await tx.ride.update({
          where: { id },
          data
        });
        if (bikeChanged || durationChanged) {
          if (existing.bikeId) {
            if (bikeChanged && hoursBefore > 0) {
              await tx.component.updateMany({
                where: { userId, bikeId: existing.bikeId },
                data: { hoursUsed: { decrement: hoursBefore } }
              });
            } else if (!bikeChanged && durationChanged && hoursDiff < 0) {
              await tx.component.updateMany({
                where: { userId, bikeId: existing.bikeId },
                data: { hoursUsed: { decrement: Math.abs(hoursDiff) } }
              });
            }
            if (bikeChanged || durationChanged && hoursDiff < 0) {
              await tx.component.updateMany({
                where: { userId, bikeId: existing.bikeId, hoursUsed: { lt: 0 } },
                data: { hoursUsed: 0 }
              });
            }
          }
          if (nextBikeId) {
            if (bikeChanged && hoursAfter > 0) {
              await tx.component.updateMany({
                where: { userId, bikeId: nextBikeId },
                data: { hoursUsed: { increment: hoursAfter } }
              });
            } else if (!bikeChanged && durationChanged && hoursDiff > 0) {
              await tx.component.updateMany({
                where: { userId, bikeId: nextBikeId },
                data: { hoursUsed: { increment: hoursDiff } }
              });
            }
          }
        }
        return updated;
      });
    },
    addBike: async (_, { input }, ctx) => {
      const userId = requireUserId(ctx);
      const manufacturer = cleanText(input.manufacturer, MAX_LABEL_LEN);
      const model = cleanText(input.model, MAX_LABEL_LEN);
      if (!manufacturer) throw new Error("manufacturer is required");
      if (!model) throw new Error("model is required");
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
            userId
          }
        });
        await syncBikeComponents(tx, {
          bikeId: bike.id,
          userId,
          components: {
            fork: input.fork,
            shock: input.shock,
            dropper: input.dropper,
            wheels: input.wheels,
            pivotBearings: input.pivotBearings
          },
          createMissing: true
        });
        return tx.bike.findUnique({
          where: { id: bike.id },
          include: { components: true }
        });
      });
    },
    updateBike: async (_, { id, input }, ctx) => {
      const userId = requireUserId(ctx);
      const existing = await prisma.bike.findUnique({
        where: { id },
        select: { userId: true }
      });
      if (!existing || existing.userId !== userId) throw new Error("Bike not found");
      const data = {};
      if (input.nickname !== void 0) data.nickname = cleanText(input.nickname, MAX_LABEL_LEN);
      if (input.manufacturer !== void 0) {
        const manufacturer = cleanText(input.manufacturer, MAX_LABEL_LEN);
        if (!manufacturer) throw new Error("manufacturer is required");
        data.manufacturer = manufacturer;
      }
      if (input.model !== void 0) {
        const updatedModel = cleanText(input.model, MAX_LABEL_LEN);
        if (!updatedModel) throw new Error("model is required");
        data.model = updatedModel;
      }
      if (input.year !== void 0) data.year = input.year == null ? null : clampYear(input.year);
      if (input.travelForkMm !== void 0) data.travelForkMm = parseTravel(input.travelForkMm) ?? null;
      if (input.travelShockMm !== void 0)
        data.travelShockMm = parseTravel(input.travelShockMm) ?? null;
      if (input.notes !== void 0) data.notes = cleanText(input.notes, MAX_NOTES_LEN);
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
            pivotBearings: input.pivotBearings
          },
          createMissing: false
        });
        return tx.bike.findUnique({ where: { id }, include: { components: true } });
      });
    },
    addComponent: async (_, { input, bikeId }, ctx) => {
      const userId = requireUserId(ctx);
      const type = input.type;
      if (bikeId) {
        const bike = await prisma.bike.findUnique({
          where: { id: bikeId },
          select: { userId: true }
        });
        if (!bike || bike.userId !== userId) throw new Error("Bike not found");
      } else if (type === client$1.ComponentType.PIVOT_BEARINGS) {
        throw new Error("Pivot bearings must be attached to a bike");
      }
      return prisma.component.create({
        data: {
          ...normalizeLooseComponentInput(type, input),
          type,
          bikeId: bikeId ?? null,
          userId,
          installedAt: /* @__PURE__ */ new Date()
        }
      });
    },
    updateComponent: async (_, { id, input }, ctx) => {
      const userId = requireUserId(ctx);
      const existing = await prisma.component.findUnique({ where: { id } });
      if (!existing || existing.userId !== userId) throw new Error("Component not found");
      const normalized = normalizeLooseComponentInput(existing.type, input, {
        brand: existing.brand,
        model: existing.model,
        notes: existing.notes,
        isStock: existing.isStock,
        hoursUsed: existing.hoursUsed,
        serviceDueAtHours: existing.serviceDueAtHours
      });
      return prisma.component.update({
        where: { id },
        data: normalized
      });
    },
    deleteComponent: async (_, { id }, ctx) => {
      const userId = requireUserId(ctx);
      const existing = await prisma.component.findUnique({ where: { id }, select: { userId: true } });
      if (!existing || existing.userId !== userId) throw new Error("Component not found");
      await prisma.component.delete({ where: { id } });
      return { ok: true, id };
    },
    logComponentService: async (_, { id }, ctx) => {
      const userId = requireUserId(ctx);
      const existing = await prisma.component.findUnique({ where: { id }, select: { userId: true } });
      if (!existing || existing.userId !== userId) throw new Error("Component not found");
      return prisma.component.update({
        where: { id },
        data: { hoursUsed: 0 }
      });
    },
    createStravaGearMapping: async (_, { input }, ctx) => {
      const userId = requireUserId(ctx);
      const bike = await prisma.bike.findUnique({
        where: { id: input.bikeId },
        select: { userId: true }
      });
      if (!bike || bike.userId !== userId) {
        throw new Error("Bike not found");
      }
      const existing = await prisma.stravaGearMapping.findUnique({
        where: {
          userId_stravaGearId: { userId, stravaGearId: input.stravaGearId }
        }
      });
      if (existing) {
        throw new Error("This Strava bike is already mapped");
      }
      return prisma.$transaction(async (tx) => {
        const mapping = await tx.stravaGearMapping.create({
          data: {
            userId,
            stravaGearId: input.stravaGearId,
            stravaGearName: input.stravaGearName ?? null,
            bikeId: input.bikeId
          },
          include: { bike: true }
        });
        const ridesToUpdate = await tx.ride.findMany({
          where: { userId, stravaGearId: input.stravaGearId, bikeId: null },
          select: { id: true, durationSeconds: true }
        });
        if (ridesToUpdate.length > 0) {
          await tx.ride.updateMany({
            where: { userId, stravaGearId: input.stravaGearId },
            data: { bikeId: input.bikeId }
          });
          const totalSeconds = ridesToUpdate.reduce((sum, r2) => sum + r2.durationSeconds, 0);
          const totalHours = totalSeconds / 3600;
          if (totalHours > 0) {
            await tx.component.updateMany({
              where: { userId, bikeId: input.bikeId },
              data: { hoursUsed: { increment: totalHours } }
            });
          }
        }
        return mapping;
      });
    },
    deleteStravaGearMapping: async (_, { id }, ctx) => {
      const userId = requireUserId(ctx);
      const mapping = await prisma.stravaGearMapping.findUnique({
        where: { id },
        select: { userId: true, stravaGearId: true, bikeId: true }
      });
      if (!mapping || mapping.userId !== userId) {
        throw new Error("Mapping not found");
      }
      await prisma.$transaction(async (tx) => {
        const rides = await tx.ride.findMany({
          where: { userId, stravaGearId: mapping.stravaGearId, bikeId: mapping.bikeId },
          select: { durationSeconds: true }
        });
        const totalSeconds = rides.reduce((sum, r2) => sum + r2.durationSeconds, 0);
        const totalHours = totalSeconds / 3600;
        await tx.ride.updateMany({
          where: { userId, stravaGearId: mapping.stravaGearId },
          data: { bikeId: null }
        });
        if (totalHours > 0) {
          await tx.component.updateMany({
            where: { userId, bikeId: mapping.bikeId },
            data: { hoursUsed: { decrement: totalHours } }
          });
          await tx.component.updateMany({
            where: { userId, bikeId: mapping.bikeId, hoursUsed: { lt: 0 } },
            data: { hoursUsed: 0 }
          });
        }
        await tx.stravaGearMapping.delete({ where: { id } });
      });
      return { ok: true, id };
    }
  },
  Bike: {
    components: (bike) => {
      if (bike.components) return bike.components;
      return prisma.component.findMany({ where: { bikeId: bike.id } });
    },
    fork: (bike) => pickComponent(bike, client$1.ComponentType.FORK),
    shock: (bike) => pickComponent(bike, client$1.ComponentType.SHOCK),
    dropper: (bike) => pickComponent(bike, client$1.ComponentType.DROPPER),
    wheels: (bike) => pickComponent(bike, client$1.ComponentType.WHEELS),
    pivotBearings: (bike) => pickComponent(bike, client$1.ComponentType.PIVOT_BEARINGS)
  },
  Component: {
    isSpare: (component) => component.bikeId == null
  },
  User: {
    activeDataSource: (parent) => parent.activeDataSource,
    accounts: async (parent) => {
      const accounts = await prisma.userAccount.findMany({
        where: { userId: parent.id },
        select: { provider: true, createdAt: true }
      });
      return accounts.map((acc) => ({
        provider: acc.provider,
        connectedAt: acc.createdAt.toISOString()
      }));
    }
  }
};
function randomString(len = 64) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ("0" + b.toString(16)).slice(-2)).join("");
}
function base64url(input) {
  const str = Buffer.from(input).toString("base64");
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sha256(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64url(digest);
}
const r$9 = express.Router();
r$9.get("/garmin/start", async (_req, res) => {
  const AUTH_URL = process.env.GARMIN_AUTH_URL;
  const CLIENT_ID2 = process.env.GARMIN_CLIENT_ID;
  const REDIRECT_URI = process.env.GARMIN_REDIRECT_URI;
  const SCOPES = process.env.GARMIN_SCOPES ?? "";
  if (!AUTH_URL || !CLIENT_ID2 || !REDIRECT_URI) {
    const missing = [
      !AUTH_URL && "GARMIN_AUTH_URL",
      !CLIENT_ID2 && "GARMIN_CLIENT_ID",
      !REDIRECT_URI && "GARMIN_REDIRECT_URI"
    ].filter(Boolean).join(", ");
    return res.status(500).send(`Missing env vars: ${missing}`);
  }
  const state = randomString(24);
  const verifier = randomString(64);
  const challenge = await sha256(verifier);
  res.cookie("ll_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV !== "development",
    maxAge: 10 * 60 * 1e3,
    path: "/"
  });
  res.cookie("ll_pkce_verifier", verifier, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV !== "development",
    maxAge: 10 * 60 * 1e3,
    path: "/"
  });
  const url = new URL(AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID2);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  if (SCOPES) url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return res.redirect(url.toString());
});
r$9.get(
  "/garmin/callback",
  async (req, res) => {
    try {
      const TOKEN_URL2 = process.env.GARMIN_TOKEN_URL;
      const REDIRECT_URI = process.env.GARMIN_REDIRECT_URI;
      const CLIENT_ID2 = process.env.GARMIN_CLIENT_ID;
      console.log("[Garmin Callback] Environment check:", {
        hasTokenUrl: !!TOKEN_URL2,
        hasRedirectUri: !!REDIRECT_URI,
        hasClientId: !!CLIENT_ID2,
        tokenUrl: TOKEN_URL2 || "MISSING"
      });
      if (!TOKEN_URL2 || !REDIRECT_URI || !CLIENT_ID2) {
        const missing = [
          !TOKEN_URL2 && "GARMIN_TOKEN_URL",
          !REDIRECT_URI && "GARMIN_REDIRECT_URI",
          !CLIENT_ID2 && "GARMIN_CLIENT_ID"
        ].filter(Boolean).join(", ");
        console.error("[Garmin Callback] Missing env vars:", missing);
        return res.status(500).send(`Missing env vars: ${missing}`);
      }
      const { code, state } = req.query;
      const cookieState = req.cookies["ll_oauth_state"];
      const verifier = req.cookies["ll_pkce_verifier"];
      if (!code || !state || !cookieState || state !== cookieState || !verifier) {
        return res.status(400).send("Invalid OAuth state/PKCE");
      }
      const userId = req.user?.id || req.sessionUser?.uid;
      if (!userId) {
        return res.status(401).send("No user - please log in first");
      }
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID2,
        code_verifier: verifier
      });
      if (process.env.GARMIN_CLIENT_SECRET) {
        body.set("client_secret", process.env.GARMIN_CLIENT_SECRET);
      }
      const tokenRes = await fetch(TOKEN_URL2, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body
      });
      if (!tokenRes.ok) {
        const text = await tokenRes.text();
        return res.status(502).send(`Token exchange failed: ${text}`);
      }
      const t = await tokenRes.json();
      const expiresAt = dateFns.addSeconds(/* @__PURE__ */ new Date(), t.expires_in ?? 3600);
      const refreshTokenNorm = t.refresh_token !== void 0 ? t.refresh_token ?? null : null;
      const GARMIN_API_BASE = process.env.GARMIN_API_BASE || "https://apis.garmin.com/wellness-api";
      const userIdRes = await fetch(`${GARMIN_API_BASE}/rest/user/id`, {
        headers: {
          "Authorization": `Bearer ${t.access_token}`,
          "Accept": "application/json"
        }
      });
      if (!userIdRes.ok) {
        const text = await userIdRes.text();
        console.error(`Failed to fetch Garmin User ID: ${userIdRes.status} ${text}`);
        return res.status(502).send(`Failed to fetch Garmin User ID: ${text}`);
      }
      const garminUser = await userIdRes.json();
      const garminUserId = garminUser.userId;
      await prisma.oauthToken.upsert({
        where: { userId_provider: { userId, provider: "garmin" } },
        create: {
          userId,
          provider: "garmin",
          accessToken: t.access_token,
          refreshToken: refreshTokenNorm,
          expiresAt
        },
        update: {
          accessToken: t.access_token,
          expiresAt,
          ...t.refresh_token !== void 0 ? { refreshToken: t.refresh_token ?? null } : {}
        }
      });
      await prisma.userAccount.upsert({
        where: {
          provider_providerUserId: {
            provider: "garmin",
            providerUserId: garminUserId
          }
        },
        create: {
          userId,
          provider: "garmin",
          providerUserId: garminUserId
        },
        update: {
          userId
          // in case user reconnects to different account
        }
      });
      res.clearCookie("ll_oauth_state", { path: "/" });
      res.clearCookie("ll_pkce_verifier", { path: "/" });
      const appBase = process.env.APP_BASE_URL ?? "http://localhost:5173";
      const user = await prisma.user.findUnique({ where: { id: userId } });
      const redirectPath = !user?.onboardingCompleted ? "/onboarding?step=5" : "/settings?garmin=connected";
      console.log("[Garmin Callback] Success! Redirecting to:", redirectPath);
      return res.redirect(`${appBase.replace(/\/$/, "")}${redirectPath}`);
    } catch (error) {
      console.error("[Garmin Callback] Error:", error);
      const appBase = process.env.APP_BASE_URL ?? "http://localhost:5173";
      return res.redirect(`${appBase}/auth/error?message=${encodeURIComponent("Garmin connection failed. Please try again.")}`);
    }
  }
);
r$9.delete("/garmin/disconnect", async (req, res) => {
  const userId = req.user?.id || req.sessionUser?.uid;
  if (!userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  try {
    await prisma.$transaction([
      prisma.oauthToken.deleteMany({
        where: {
          userId,
          provider: "garmin"
        }
      }),
      prisma.userAccount.deleteMany({
        where: {
          userId,
          provider: "garmin"
        }
      })
    ]);
    console.log(`[Garmin Disconnect] User ${userId} disconnected Garmin`);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("[Garmin Disconnect] Error:", error);
    return res.status(500).json({ error: "Failed to disconnect" });
  }
});
const r$8 = express.Router();
r$8.get("/strava/start", async (_req, res) => {
  const AUTH_URL = "https://www.strava.com/oauth/authorize";
  const CLIENT_ID2 = process.env.STRAVA_CLIENT_ID;
  const REDIRECT_URI = process.env.STRAVA_REDIRECT_URI;
  const SCOPE = "activity:read_all";
  if (!CLIENT_ID2 || !REDIRECT_URI) {
    const missing = [
      !CLIENT_ID2 && "STRAVA_CLIENT_ID",
      !REDIRECT_URI && "STRAVA_REDIRECT_URI"
    ].filter(Boolean).join(", ");
    return res.status(500).send(`Missing env vars: ${missing}`);
  }
  const state = randomString(24);
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax",
    // 'lax' allows cookies to be sent on top-level navigations (OAuth redirects)
    secure: process.env.NODE_ENV !== "development",
    maxAge: 10 * 60 * 1e3,
    path: "/"
  };
  console.log("[Strava Start] Setting state cookie:", {
    state,
    cookieOptions,
    nodeEnv: process.env.NODE_ENV
  });
  res.cookie("ll_strava_state", state, cookieOptions);
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", CLIENT_ID2);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", state);
  return res.redirect(url.toString());
});
r$8.get(
  "/strava/callback",
  async (req, res) => {
    try {
      const TOKEN_URL2 = "https://www.strava.com/oauth/token";
      const REDIRECT_URI = process.env.STRAVA_REDIRECT_URI;
      const CLIENT_ID2 = process.env.STRAVA_CLIENT_ID;
      const CLIENT_SECRET2 = process.env.STRAVA_CLIENT_SECRET;
      console.log("[Strava Callback] Environment check:", {
        hasRedirectUri: !!REDIRECT_URI,
        hasClientId: !!CLIENT_ID2,
        hasClientSecret: !!CLIENT_SECRET2
      });
      if (!REDIRECT_URI || !CLIENT_ID2 || !CLIENT_SECRET2) {
        const missing = [
          !REDIRECT_URI && "STRAVA_REDIRECT_URI",
          !CLIENT_ID2 && "STRAVA_CLIENT_ID",
          !CLIENT_SECRET2 && "STRAVA_CLIENT_SECRET"
        ].filter(Boolean).join(", ");
        console.error("[Strava Callback] Missing env vars:", missing);
        return res.status(500).send(`Missing env vars: ${missing}`);
      }
      const { code, state } = req.query;
      const cookieState = req.cookies["ll_strava_state"];
      console.log("[Strava Callback] OAuth state check:", {
        hasCode: !!code,
        queryState: state,
        cookieState,
        statesMatch: state === cookieState,
        allCookies: Object.keys(req.cookies)
      });
      if (!code || !state || !cookieState || state !== cookieState) {
        return res.status(400).send("Invalid OAuth state");
      }
      const userId = req.user?.id || req.sessionUser?.uid;
      if (!userId) {
        return res.status(401).send("No user - please log in first");
      }
      const body = new URLSearchParams({
        client_id: CLIENT_ID2,
        client_secret: CLIENT_SECRET2,
        code,
        grant_type: "authorization_code"
      });
      const tokenRes = await fetch(TOKEN_URL2, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body
      });
      if (!tokenRes.ok) {
        const text = await tokenRes.text();
        console.error("[Strava Callback] Token exchange failed:", text);
        return res.status(502).send(`Token exchange failed: ${text}`);
      }
      const t = await tokenRes.json();
      const stravaUserId = t.athlete.id.toString();
      const expiresAt = new Date(t.expires_at * 1e3);
      console.log("[Strava Callback] Token received, expires at:", expiresAt);
      console.log("[Strava Callback] Strava athlete ID:", stravaUserId);
      await prisma.oauthToken.upsert({
        where: { userId_provider: { userId, provider: "strava" } },
        create: {
          userId,
          provider: "strava",
          accessToken: t.access_token,
          refreshToken: t.refresh_token,
          expiresAt
        },
        update: {
          accessToken: t.access_token,
          refreshToken: t.refresh_token,
          expiresAt
        }
      });
      await prisma.userAccount.upsert({
        where: {
          provider_providerUserId: {
            provider: "strava",
            providerUserId: stravaUserId
          }
        },
        create: {
          userId,
          provider: "strava",
          providerUserId: stravaUserId
        },
        update: {
          userId
          // in case user reconnects to different account
        }
      });
      await prisma.user.update({
        where: { id: userId },
        data: { stravaUserId }
      });
      const userAccounts = await prisma.userAccount.findMany({
        where: { userId },
        select: { provider: true }
      });
      const hasGarmin = userAccounts.some((acc) => acc.provider === "garmin");
      const hasStrava = userAccounts.some((acc) => acc.provider === "strava");
      const bothConnected = hasGarmin && hasStrava;
      res.clearCookie("ll_strava_state", { path: "/" });
      const appBase = process.env.APP_BASE_URL ?? "http://localhost:5173";
      const user = await prisma.user.findUnique({ where: { id: userId } });
      let redirectPath;
      if (!user?.onboardingCompleted) {
        redirectPath = "/onboarding?step=5";
      } else if (bothConnected) {
        redirectPath = "/settings?strava=connected&prompt=choose-source";
      } else {
        redirectPath = "/settings?strava=connected";
      }
      console.log("[Strava Callback] Success! Redirecting to:", redirectPath);
      return res.redirect(`${appBase.replace(/\/$/, "")}${redirectPath}`);
    } catch (error) {
      console.error("[Strava Callback] Error:", error);
      const appBase = process.env.APP_BASE_URL ?? "http://localhost:5173";
      return res.redirect(
        `${appBase}/auth/error?message=${encodeURIComponent("Strava connection failed. Please try again.")}`
      );
    }
  }
);
r$8.delete("/strava/disconnect", async (req, res) => {
  const userId = req.user?.id || req.sessionUser?.uid;
  if (!userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { activeDataSource: true }
    });
    await prisma.$transaction([
      prisma.oauthToken.deleteMany({
        where: {
          userId,
          provider: "strava"
        }
      }),
      prisma.userAccount.deleteMany({
        where: {
          userId,
          provider: "strava"
        }
      }),
      prisma.user.update({
        where: { id: userId },
        data: {
          stravaUserId: null,
          ...user?.activeDataSource === "strava" ? { activeDataSource: null } : {}
        }
      })
    ]);
    console.log(`[Strava Disconnect] User ${userId} disconnected Strava`);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("[Strava Disconnect] Error:", error);
    return res.status(500).json({ error: "Failed to disconnect" });
  }
});
async function getValidGarminToken(userId) {
  const token = await prisma.oauthToken.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: "garmin"
      }
    }
  });
  if (!token) {
    return null;
  }
  const now = /* @__PURE__ */ new Date();
  const expiryBuffer = new Date(token.expiresAt.getTime() - 5 * 60 * 1e3);
  if (now < expiryBuffer) {
    return token.accessToken;
  }
  if (!token.refreshToken) {
    console.error("[Garmin Token] No refresh token available");
    return null;
  }
  try {
    const TOKEN_URL2 = process.env.GARMIN_TOKEN_URL;
    const CLIENT_ID2 = process.env.GARMIN_CLIENT_ID;
    if (!TOKEN_URL2 || !CLIENT_ID2) {
      console.error("[Garmin Token] Missing GARMIN_TOKEN_URL or GARMIN_CLIENT_ID");
      return null;
    }
    console.log("[Garmin Token] Refreshing expired token for user:", userId);
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token.refreshToken,
      client_id: CLIENT_ID2
    });
    if (process.env.GARMIN_CLIENT_SECRET) {
      body.set("client_secret", process.env.GARMIN_CLIENT_SECRET);
    }
    const refreshRes = await fetch(TOKEN_URL2, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });
    if (!refreshRes.ok) {
      const text = await refreshRes.text();
      console.error(`[Garmin Token] Refresh failed: ${refreshRes.status} ${text}`);
      return null;
    }
    const newTokens = await refreshRes.json();
    const newExpiresAt = dateFns.addSeconds(/* @__PURE__ */ new Date(), newTokens.expires_in ?? 3600);
    await prisma.oauthToken.update({
      where: {
        userId_provider: {
          userId,
          provider: "garmin"
        }
      },
      data: {
        accessToken: newTokens.access_token,
        expiresAt: newExpiresAt,
        ...newTokens.refresh_token ? { refreshToken: newTokens.refresh_token } : {}
      }
    });
    console.log("[Garmin Token] Token refreshed successfully");
    return newTokens.access_token;
  } catch (error) {
    console.error("[Garmin Token] Error refreshing token:", error);
    return null;
  }
}
const buildLocationString = (parts) => {
  const cleaned = parts.map((part) => typeof part === "string" ? part.trim() : part).filter((part) => Boolean(part && part.length > 0));
  return cleaned.length ? cleaned.join(", ") : null;
};
const formatLatLon = (lat, lon) => {
  if (!Number.isFinite(lat ?? NaN) || !Number.isFinite(lon ?? NaN)) {
    return null;
  }
  const latStr = lat.toFixed(3);
  const lonStr = lon.toFixed(3);
  return `Lat ${latStr}, Lon ${lonStr}`;
};
const deriveLocation = (opts) => {
  const singleValue = opts.city ?? opts.state ?? opts.country ?? opts.fallback ?? null;
  return buildLocationString([opts.city, opts.state]) ?? buildLocationString([opts.city, opts.country]) ?? buildLocationString([opts.state, opts.country]) ?? (singleValue?.trim() || null) ?? formatLatLon(opts.lat, opts.lon);
};
const shouldApplyAutoLocation = (existing, incoming) => {
  if (!incoming) return void 0;
  if (existing && existing.trim().length > 0) return void 0;
  return incoming;
};
const r$7 = express.Router();
r$7.post(
  "/webhooks/garmin/deregistration",
  async (req, res) => {
    try {
      const { deregistrations } = req.body;
      if (!deregistrations || !Array.isArray(deregistrations)) {
        console.warn("[Garmin Deregistration] Invalid payload:", req.body);
        return res.status(400).json({ error: "Invalid deregistration payload" });
      }
      console.log(`[Garmin Deregistration] Received ${deregistrations.length} deregistration(s)`);
      for (const { userId: garminUserId } of deregistrations) {
        const userAccount = await prisma.userAccount.findUnique({
          where: {
            provider_providerUserId: {
              provider: "garmin",
              providerUserId: garminUserId
            }
          }
        });
        if (!userAccount) {
          console.warn(`[Garmin Deregistration] Unknown Garmin userId: ${garminUserId}`);
          continue;
        }
        await prisma.$transaction([
          prisma.oauthToken.deleteMany({
            where: {
              userId: userAccount.userId,
              provider: "garmin"
            }
          }),
          prisma.userAccount.delete({
            where: {
              provider_providerUserId: {
                provider: "garmin",
                providerUserId: garminUserId
              }
            }
          })
        ]);
        console.log(`[Garmin Deregistration] Removed Garmin connection for userId: ${userAccount.userId}`);
      }
      return res.status(200).send("OK");
    } catch (error) {
      console.error("[Garmin Deregistration] Error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);
r$7.post(
  "/webhooks/garmin/permissions",
  async (req, res) => {
    try {
      const { userPermissionsChange } = req.body;
      if (!userPermissionsChange || !Array.isArray(userPermissionsChange)) {
        console.warn("[Garmin Permissions] Invalid payload:", req.body);
        return res.status(400).json({ error: "Invalid permissions payload" });
      }
      console.log(`[Garmin Permissions] Received ${userPermissionsChange.length} permission change(s)`);
      for (const change of userPermissionsChange) {
        const { userId: garminUserId, permissions } = change;
        const userAccount = await prisma.userAccount.findUnique({
          where: {
            provider_providerUserId: {
              provider: "garmin",
              providerUserId: garminUserId
            }
          }
        });
        if (!userAccount) {
          console.warn(`[Garmin Permissions] Unknown Garmin userId: ${garminUserId}`);
          continue;
        }
        console.log(`[Garmin Permissions] User ${userAccount.userId} permissions:`, permissions);
        if (!permissions.includes("ACTIVITY_EXPORT")) {
          console.warn(`[Garmin Permissions] User ${userAccount.userId} revoked ACTIVITY_EXPORT permission`);
        }
      }
      return res.status(200).send("OK");
    } catch (error) {
      console.error("[Garmin Permissions] Error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);
r$7.post(
  "/webhooks/garmin/activities",
  async (req, res) => {
    try {
      const { activities } = req.body;
      if (!activities || !Array.isArray(activities)) {
        console.warn("[Garmin Activities PUSH] Invalid payload:", req.body);
        return res.status(400).json({ error: "Invalid activities payload" });
      }
      console.log(`[Garmin Activities PUSH] Received ${activities.length} activity(ies)`);
      res.status(200).send("OK");
      for (const activity of activities) {
        try {
          await processActivityPush(activity);
        } catch (error) {
          console.error(`[Garmin Activities PUSH] Failed to process activity ${activity.summaryId}:`, error);
        }
      }
    } catch (error) {
      console.error("[Garmin Activities PUSH] Error:", error);
    }
  }
);
r$7.post(
  "/webhooks/garmin/activities-ping",
  async (req, res) => {
    console.log(`[Garmin PING Webhook] Incoming request at ${(/* @__PURE__ */ new Date()).toISOString()}`);
    console.log(`[Garmin PING Webhook] Headers:`, JSON.stringify(req.headers, null, 2));
    console.log(`[Garmin PING Webhook] Body:`, JSON.stringify(req.body, null, 2));
    try {
      const { activityDetails } = req.body;
      if (!activityDetails || !Array.isArray(activityDetails)) {
        console.warn("[Garmin Activities PING] Invalid payload:", req.body);
        return res.status(400).json({ error: "Invalid activities payload" });
      }
      console.log(`[Garmin Activities PING] Received ${activityDetails.length} notification(s)`);
      res.status(200).send("OK");
      for (const notification of activityDetails) {
        try {
          await processActivityPing(notification);
        } catch (error) {
          console.error(`[Garmin Activities PING] Failed to process notification ${notification.summaryId}:`, error);
        }
      }
    } catch (error) {
      console.error("[Garmin Activities PING] Error:", error);
    }
  }
);
async function processActivityPush(activity) {
  const {
    activityId,
    activityType,
    startTimeInSeconds,
    _durationInSeconds,
    distanceInMeters,
    totalElevationGainInMeters,
    _averageHeartRateInBeatsPerMinute
  } = activity;
  console.log(`[Garmin Activities PUSH] Processing activity ${activityId} (${activityType})`);
  console.warn("[Garmin Activities PUSH] PUSH notification does not include userId - cannot identify user");
  console.warn("[Garmin Activities PUSH] Consider using PING mode instead (/webhooks/garmin/activities-ping)");
}
async function processActivityPing(notification) {
  const { userId: garminUserId, summaryId } = notification;
  console.log(`[Garmin Activities PING] Processing notification for summaryId: ${summaryId}`);
  const userAccount = await prisma.userAccount.findUnique({
    where: {
      provider_providerUserId: {
        provider: "garmin",
        providerUserId: garminUserId
      }
    }
  });
  if (!userAccount) {
    console.warn(`[Garmin Activities PING] Unknown Garmin userId: ${garminUserId}`);
    return;
  }
  console.log(`[Garmin Activities PING] Found user: ${userAccount.userId}`);
  const API_BASE2 = process.env.GARMIN_API_BASE || "https://apis.garmin.com/wellness-api";
  const accessToken = await getValidGarminToken(userAccount.userId);
  if (!accessToken) {
    console.error(`[Garmin Activities PING] No valid OAuth token for user ${userAccount.userId}`);
    return;
  }
  const activityUrl = `${API_BASE2}/rest/activityFile/${summaryId}`;
  try {
    const activityRes = await fetch(activityUrl, {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json"
      }
    });
    if (!activityRes.ok) {
      const text = await activityRes.text();
      console.error(`[Garmin Activities PING] Failed to fetch activity ${summaryId}: ${activityRes.status} ${text}`);
      return;
    }
    const activityDetail = await activityRes.json();
    const CYCLING_ACTIVITY_TYPES = [
      "cycling",
      "bmx",
      "cyclocross",
      "downhill_biking",
      "e_bike_fitness",
      "e_bike_mountain",
      "e_enduro_mtb",
      "enduro_mtb",
      "gravel_cycling",
      "indoor_cycling",
      "mountain_biking",
      "recumbent_cycling",
      "road_biking",
      "track_cycling",
      "virtual_ride",
      "handcycling",
      "indoor_handcycling"
    ];
    const activityTypeLower = activityDetail.activityType.toLowerCase().replace(/\s+/g, "_");
    if (!CYCLING_ACTIVITY_TYPES.includes(activityTypeLower)) {
      console.log(`[Garmin Activities PING] Skipping non-cycling activity: ${activityDetail.activityType} (${summaryId})`);
      return;
    }
    console.log(`[Garmin Activities PING] Processing cycling activity: ${activityDetail.activityType}`);
    const distanceMiles = activityDetail.distanceInMeters ? activityDetail.distanceInMeters * 621371e-9 : 0;
    const elevationGainFeet = activityDetail.totalElevationGainInMeters ?? activityDetail.elevationGainInMeters ? (activityDetail.totalElevationGainInMeters ?? activityDetail.elevationGainInMeters) * 3.28084 : 0;
    const startTime = new Date(activityDetail.startTimeInSeconds * 1e3);
    const autoLocation = deriveLocation({
      city: activityDetail.locationName ?? null,
      state: null,
      country: null,
      lat: activityDetail.startLatitudeInDegrees ?? activityDetail.beginLatitude ?? null,
      lon: activityDetail.startLongitudeInDegrees ?? activityDetail.beginLongitude ?? null
    });
    const existingRide = await prisma.ride.findUnique({
      where: { garminActivityId: summaryId },
      select: { location: true }
    });
    const locationUpdate = shouldApplyAutoLocation(
      existingRide?.location ?? null,
      autoLocation
    );
    await prisma.ride.upsert({
      where: {
        garminActivityId: summaryId
      },
      create: {
        userId: userAccount.userId,
        garminActivityId: summaryId,
        startTime,
        durationSeconds: activityDetail.durationInSeconds,
        distanceMiles,
        elevationGainFeet,
        averageHr: activityDetail.averageHeartRateInBeatsPerMinute ?? null,
        rideType: activityDetail.activityType,
        notes: activityDetail.activityName ?? null,
        location: autoLocation
      },
      update: {
        startTime,
        durationSeconds: activityDetail.durationInSeconds,
        distanceMiles,
        elevationGainFeet,
        averageHr: activityDetail.averageHeartRateInBeatsPerMinute ?? null,
        rideType: activityDetail.activityType,
        notes: activityDetail.activityName ?? null,
        ...locationUpdate !== void 0 ? { location: locationUpdate } : {}
      }
    });
    console.log(`[Garmin Activities PING] Successfully stored ride for activity ${summaryId}`);
  } catch (error) {
    console.error(`[Garmin Activities PING] Error fetching/storing activity ${summaryId}:`, error);
    throw error;
  }
}
async function getValidStravaToken(userId) {
  const token = await prisma.oauthToken.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: "strava"
      }
    }
  });
  if (!token) {
    return null;
  }
  const now = /* @__PURE__ */ new Date();
  const expiryBuffer = new Date(token.expiresAt.getTime() - 5 * 60 * 1e3);
  if (now < expiryBuffer) {
    return token.accessToken;
  }
  if (!token.refreshToken) {
    console.error("[Strava Token] No refresh token available");
    return null;
  }
  try {
    const TOKEN_URL2 = "https://www.strava.com/oauth/token";
    const CLIENT_ID2 = process.env.STRAVA_CLIENT_ID;
    const CLIENT_SECRET2 = process.env.STRAVA_CLIENT_SECRET;
    if (!CLIENT_ID2 || !CLIENT_SECRET2) {
      console.error("[Strava Token] Missing STRAVA_CLIENT_ID or STRAVA_CLIENT_SECRET");
      return null;
    }
    console.log("[Strava Token] Refreshing expired token for user:", userId);
    const body = new URLSearchParams({
      client_id: CLIENT_ID2,
      client_secret: CLIENT_SECRET2,
      grant_type: "refresh_token",
      refresh_token: token.refreshToken
    });
    const refreshRes = await fetch(TOKEN_URL2, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });
    if (!refreshRes.ok) {
      const text = await refreshRes.text();
      console.error(`[Strava Token] Refresh failed: ${refreshRes.status} ${text}`);
      return null;
    }
    const newTokens = await refreshRes.json();
    const newExpiresAt = new Date(newTokens.expires_at * 1e3);
    await prisma.oauthToken.update({
      where: {
        userId_provider: {
          userId,
          provider: "strava"
        }
      },
      data: {
        accessToken: newTokens.access_token,
        refreshToken: newTokens.refresh_token,
        // MUST update this
        expiresAt: newExpiresAt
      }
    });
    console.log("[Strava Token] Token refreshed successfully, expires at:", newExpiresAt);
    return newTokens.access_token;
  } catch (error) {
    console.error("[Strava Token] Error refreshing token:", error);
    return null;
  }
}
const r$6 = express.Router();
r$6.get(
  "/webhooks/strava",
  async (req, res) => {
    const { "hub.mode": mode, "hub.challenge": challenge, "hub.verify_token": verifyToken } = req.query;
    console.log("[Strava Webhook Verification] Received verification request:", {
      mode,
      challenge,
      verifyToken: verifyToken ? "present" : "missing"
    });
    const VERIFY_TOKEN = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
    if (!VERIFY_TOKEN) {
      console.error("[Strava Webhook Verification] STRAVA_WEBHOOK_VERIFY_TOKEN not set");
      return res.status(500).json({ error: "Server configuration error" });
    }
    if (mode === "subscribe" && verifyToken === VERIFY_TOKEN && challenge) {
      console.log("[Strava Webhook Verification] Verification successful");
      return res.json({ "hub.challenge": challenge });
    }
    console.warn("[Strava Webhook Verification] Verification failed");
    return res.status(403).json({ error: "Forbidden" });
  }
);
const extractStravaLocation = (activity) => deriveLocation({
  city: activity.location_city ?? null,
  state: activity.location_state ?? null,
  country: activity.location_country ?? null,
  lat: activity.start_latlng?.[0] ?? null,
  lon: activity.start_latlng?.[1] ?? null
});
r$6.post(
  "/webhooks/strava",
  async (req, res) => {
    console.log(`[Strava Webhook] Incoming event at ${(/* @__PURE__ */ new Date()).toISOString()}`);
    console.log(`[Strava Webhook] Payload:`, JSON.stringify(req.body, null, 2));
    try {
      const event = req.body;
      res.status(200).send("EVENT_RECEIVED");
      if (event.object_type === "activity") {
        await processActivityEvent(event);
      } else if (event.object_type === "athlete") {
        console.log(`[Strava Webhook] Athlete event ${event.aspect_type} for athlete ${event.owner_id}`);
      }
    } catch (error) {
      console.error("[Strava Webhook] Error processing event:", error);
    }
  }
);
r$6.post(
  "/webhooks/strava/deauthorization",
  async (req, res) => {
    try {
      const { athlete_id } = req.body;
      console.log(`[Strava Deauthorization] Athlete ${athlete_id} revoked access`);
      const userAccount = await prisma.userAccount.findUnique({
        where: {
          provider_providerUserId: {
            provider: "strava",
            providerUserId: athlete_id.toString()
          }
        }
      });
      if (!userAccount) {
        console.warn(`[Strava Deauthorization] Unknown Strava athlete ID: ${athlete_id}`);
        return res.status(200).send("OK");
      }
      const user = await prisma.user.findUnique({
        where: { id: userAccount.userId },
        select: { activeDataSource: true }
      });
      await prisma.$transaction([
        prisma.oauthToken.deleteMany({
          where: {
            userId: userAccount.userId,
            provider: "strava"
          }
        }),
        prisma.userAccount.delete({
          where: {
            provider_providerUserId: {
              provider: "strava",
              providerUserId: athlete_id.toString()
            }
          }
        }),
        prisma.user.update({
          where: { id: userAccount.userId },
          data: {
            stravaUserId: null,
            ...user?.activeDataSource === "strava" ? { activeDataSource: null } : {}
          }
        })
      ]);
      console.log(`[Strava Deauthorization] Removed Strava connection for userId: ${userAccount.userId}`);
      return res.status(200).send("OK");
    } catch (error) {
      console.error("[Strava Deauthorization] Error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);
const secondsToHours = (seconds) => Math.max(0, seconds ?? 0) / 3600;
async function syncBikeComponentHours(tx, userId, previous, next) {
  const prevBikeId = previous.bikeId;
  const nextBikeId = next.bikeId;
  const prevHours = secondsToHours(previous.durationSeconds);
  const nextHours = secondsToHours(next.durationSeconds);
  const bikeChanged = prevBikeId !== nextBikeId;
  const hoursDiff = nextHours - prevHours;
  if (prevBikeId) {
    if (bikeChanged && prevHours > 0) {
      await tx.component.updateMany({
        where: { userId, bikeId: prevBikeId },
        data: { hoursUsed: { decrement: prevHours } }
      });
    } else if (!bikeChanged && hoursDiff < 0) {
      await tx.component.updateMany({
        where: { userId, bikeId: prevBikeId },
        data: { hoursUsed: { decrement: Math.abs(hoursDiff) } }
      });
    }
    if (bikeChanged || hoursDiff < 0) {
      await tx.component.updateMany({
        where: { userId, bikeId: prevBikeId, hoursUsed: { lt: 0 } },
        data: { hoursUsed: 0 }
      });
    }
  }
  if (nextBikeId) {
    if (bikeChanged && nextHours > 0) {
      await tx.component.updateMany({
        where: { userId, bikeId: nextBikeId },
        data: { hoursUsed: { increment: nextHours } }
      });
    } else if (!bikeChanged && hoursDiff > 0) {
      await tx.component.updateMany({
        where: { userId, bikeId: nextBikeId },
        data: { hoursUsed: { increment: hoursDiff } }
      });
    }
  }
}
async function processActivityEvent(event) {
  const { object_id: activityId, aspect_type, owner_id: athleteId } = event;
  console.log(`[Strava Activity Event] ${aspect_type} for activity ${activityId}, athlete ${athleteId}`);
  const userAccount = await prisma.userAccount.findUnique({
    where: {
      provider_providerUserId: {
        provider: "strava",
        providerUserId: athleteId.toString()
      }
    }
  });
  if (!userAccount) {
    console.warn(`[Strava Activity Event] Unknown Strava athlete ID: ${athleteId}`);
    return;
  }
  console.log(`[Strava Activity Event] Found user: ${userAccount.userId}`);
  const user = await prisma.user.findUnique({
    where: { id: userAccount.userId },
    select: { activeDataSource: true }
  });
  if (user?.activeDataSource && user.activeDataSource !== "strava") {
    console.log(`[Strava Activity Event] User's active source is ${user.activeDataSource}, skipping Strava activity`);
    return;
  }
  if (aspect_type === "delete") {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.ride.findUnique({
        where: { stravaActivityId: activityId.toString() },
        select: { id: true, userId: true, durationSeconds: true, bikeId: true }
      });
      if (!existing || existing.userId !== userAccount.userId) {
        console.log(`[Strava Activity Event] No ride to delete for activity ${activityId}`);
        return;
      }
      await syncBikeComponentHours(
        tx,
        userAccount.userId,
        { bikeId: existing.bikeId ?? null, durationSeconds: existing.durationSeconds },
        { bikeId: null, durationSeconds: 0 }
      );
      await tx.ride.delete({ where: { id: existing.id } });
    });
    console.log(`[Strava Activity Event] Deleted ride for activity ${activityId}`);
    return;
  }
  if (aspect_type === "create" || aspect_type === "update") {
    const accessToken = await getValidStravaToken(userAccount.userId);
    if (!accessToken) {
      console.error(`[Strava Activity Event] No valid access token for user ${userAccount.userId}`);
      return;
    }
    const activityUrl = `https://www.strava.com/api/v3/activities/${activityId}`;
    try {
      const activityRes = await fetch(activityUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json"
        }
      });
      if (!activityRes.ok) {
        const text = await activityRes.text();
        console.error(`[Strava Activity Event] Failed to fetch activity ${activityId}: ${activityRes.status} ${text}`);
        return;
      }
      const activity = await activityRes.json();
      const CYCLING_SPORT_TYPES = [
        "Ride",
        "MountainBikeRide",
        "GravelRide",
        "VirtualRide",
        "EBikeRide",
        "EMountainBikeRide",
        "Handcycle"
      ];
      if (!CYCLING_SPORT_TYPES.includes(activity.sport_type)) {
        console.log(`[Strava Activity Event] Skipping non-cycling activity: ${activity.sport_type}`);
        return;
      }
      console.log(`[Strava Activity Event] Processing cycling activity: ${activity.sport_type}`);
      const distanceMiles = activity.distance * 621371e-9;
      const elevationGainFeet = activity.total_elevation_gain * 3.28084;
      const startTime = new Date(activity.start_date);
      let bikeId = null;
      if (activity.gear_id) {
        const mapping = await prisma.stravaGearMapping.findUnique({
          where: {
            userId_stravaGearId: {
              userId: userAccount.userId,
              stravaGearId: activity.gear_id
            }
          }
        });
        bikeId = mapping?.bikeId ?? null;
      }
      if (!bikeId) {
        const userBikes = await prisma.bike.findMany({
          where: { userId: userAccount.userId },
          select: { id: true }
        });
        if (userBikes.length === 1) {
          bikeId = userBikes[0].id;
        }
      }
      const autoLocation = extractStravaLocation(activity);
      await prisma.$transaction(async (tx) => {
        const existing = await tx.ride.findUnique({
          where: { stravaActivityId: activityId.toString() },
          select: { durationSeconds: true, bikeId: true, location: true }
        });
        const locationUpdate = shouldApplyAutoLocation(existing?.location ?? null, autoLocation);
        const ride = await tx.ride.upsert({
          where: {
            stravaActivityId: activityId.toString()
          },
          create: {
            userId: userAccount.userId,
            stravaActivityId: activityId.toString(),
            stravaGearId: activity.gear_id ?? null,
            startTime,
            durationSeconds: activity.moving_time,
            distanceMiles,
            elevationGainFeet,
            averageHr: activity.average_heartrate ? Math.round(activity.average_heartrate) : null,
            rideType: activity.sport_type,
            notes: activity.name || null,
            bikeId,
            location: autoLocation
          },
          update: {
            startTime,
            stravaGearId: activity.gear_id ?? null,
            durationSeconds: activity.moving_time,
            distanceMiles,
            elevationGainFeet,
            averageHr: activity.average_heartrate ? Math.round(activity.average_heartrate) : null,
            rideType: activity.sport_type,
            notes: activity.name || null,
            bikeId,
            ...locationUpdate !== void 0 ? { location: locationUpdate } : {}
          }
        });
        await syncBikeComponentHours(
          tx,
          userAccount.userId,
          {
            bikeId: existing?.bikeId ?? null,
            durationSeconds: existing?.durationSeconds ?? null
          },
          {
            bikeId: ride.bikeId ?? null,
            durationSeconds: ride.durationSeconds
          }
        );
      });
      console.log(`[Strava Activity Event] Successfully stored ride for activity ${activityId}`);
    } catch (error) {
      console.error(`[Strava Activity Event] Error fetching/storing activity ${activityId}:`, error);
      throw error;
    }
  }
}
const r$5 = express.Router();
r$5.get(
  "/garmin/backfill/fetch",
  async (req, res) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    try {
      const days = parseInt(req.query.days || "30", 10);
      if (isNaN(days) || days < 1 || days > 365) {
        return res.status(400).json({ error: "Days must be between 1 and 365" });
      }
      const accessToken = await getValidGarminToken(userId);
      if (!accessToken) {
        return res.status(400).json({ error: "Garmin not connected or token expired. Please reconnect your Garmin account." });
      }
      const endDate = /* @__PURE__ */ new Date();
      const startDate = dateFns.subDays(endDate, days);
      const startDateStr = startDate.toISOString().split("T")[0];
      const endDateStr = endDate.toISOString().split("T")[0];
      console.log(`[Garmin Backfill] Triggering backfill for ${startDateStr} to ${endDateStr}`);
      const API_BASE2 = process.env.GARMIN_API_BASE || "https://apis.garmin.com/wellness-api";
      const CHUNK_DAYS = 30;
      let currentStartDate = new Date(startDate);
      let totalChunks = 0;
      const errors = [];
      console.log(`[Garmin Backfill] Triggering async backfill requests`);
      while (currentStartDate < endDate) {
        const chunkEndDate = new Date(currentStartDate);
        chunkEndDate.setDate(chunkEndDate.getDate() + CHUNK_DAYS);
        const actualChunkEndDate = chunkEndDate > endDate ? endDate : chunkEndDate;
        const chunkStartSeconds = Math.floor(currentStartDate.getTime() / 1e3);
        const chunkEndSeconds = Math.floor(actualChunkEndDate.getTime() / 1e3);
        console.log(`[Garmin Backfill] Triggering backfill chunk: ${currentStartDate.toISOString()} to ${actualChunkEndDate.toISOString()}`);
        const url = `${API_BASE2}/rest/backfill/activities?summaryStartTimeInSeconds=${chunkStartSeconds}&summaryEndTimeInSeconds=${chunkEndSeconds}`;
        try {
          const backfillRes = await fetch(url, {
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "Accept": "application/json"
            }
          });
          if (backfillRes.status === 202) {
            console.log(`[Garmin Backfill] Backfill request accepted for chunk ${totalChunks + 1}`);
            totalChunks++;
          } else if (backfillRes.status === 409) {
            console.log(`[Garmin Backfill] Backfill already in progress for this time period`);
            errors.push(`Duplicate request for period ${currentStartDate.toISOString().split("T")[0]}`);
          } else if (backfillRes.status === 400) {
            const text = await backfillRes.text();
            const minStartDate = extractMinStartDate(text);
            if (minStartDate && minStartDate > currentStartDate) {
              console.warn(
                `[Garmin Backfill] Chunk ${currentStartDate.toISOString()} rejected. Adjusting start to Garmin min ${minStartDate.toISOString()}`
              );
              errors.push(
                `Adjusted start date to ${minStartDate.toISOString()} due to Garmin min start restriction`
              );
              const alignedMinStart = new Date(Math.ceil(minStartDate.getTime() / 1e3) * 1e3);
              currentStartDate = alignedMinStart;
              continue;
            }
            console.error(`[Garmin Backfill] Failed to trigger backfill chunk: ${backfillRes.status} ${text}`);
            errors.push(
              `Failed for period ${currentStartDate.toISOString().split("T")[0]}: ${backfillRes.status}`
            );
          } else {
            const text = await backfillRes.text();
            console.error(`[Garmin Backfill] Failed to trigger backfill chunk: ${backfillRes.status} ${text}`);
            errors.push(`Failed for period ${currentStartDate.toISOString().split("T")[0]}: ${backfillRes.status}`);
          }
        } catch (error) {
          console.error(`[Garmin Backfill] Error triggering backfill chunk:`, error);
          errors.push(`Error for period ${currentStartDate.toISOString().split("T")[0]}`);
        }
        currentStartDate = new Date(actualChunkEndDate);
        currentStartDate.setDate(currentStartDate.getDate() + 1);
      }
      console.log(`[Garmin Backfill] Triggered ${totalChunks} backfill request(s)`);
      const duplicateErrors = errors.filter((e) => e.includes("Duplicate request"));
      const allDuplicates = duplicateErrors.length === errors.length && errors.length > 0;
      if (totalChunks === 0 && allDuplicates) {
        return res.status(409).json({
          error: "Backfill already in progress",
          message: `A backfill for this time period is already in progress. Your rides will sync automatically when it completes.`,
          details: errors
        });
      }
      if (totalChunks === 0) {
        return res.status(400).json({
          error: "Failed to trigger any backfill requests",
          details: errors
        });
      }
      return res.json({
        success: true,
        message: `Backfill triggered for ${days} days. Your rides will sync automatically via webhooks.`,
        chunksRequested: totalChunks,
        warnings: errors.length > 0 ? errors : void 0
      });
    } catch (error) {
      console.error("[Garmin Backfill] Error:", error);
      return res.status(500).json({ error: "Failed to fetch activities" });
    }
  }
);
r$5.get(
  "/garmin/backfill/garmin-user-id",
  async (req, res) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    try {
      const userAccount = await prisma.userAccount.findFirst({
        where: {
          userId,
          provider: "garmin"
        },
        select: {
          providerUserId: true
        }
      });
      if (!userAccount) {
        return res.status(404).json({ error: "Garmin account not connected" });
      }
      return res.json({
        garminUserId: userAccount.providerUserId,
        message: "Use this ID in the Garmin Developer Dashboard Backfill tool"
      });
    } catch (error) {
      console.error("[Garmin User ID] Error:", error);
      return res.status(500).json({ error: "Failed to fetch Garmin user ID" });
    }
  }
);
r$5.get(
  "/garmin/backfill/status",
  async (req, res) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    try {
      const thirtyDaysAgo = dateFns.subDays(/* @__PURE__ */ new Date(), 30);
      const recentGarminRides = await prisma.ride.findMany({
        where: {
          userId,
          garminActivityId: { not: null },
          startTime: { gte: thirtyDaysAgo }
        },
        orderBy: { startTime: "desc" },
        take: 50,
        select: {
          id: true,
          garminActivityId: true,
          startTime: true,
          rideType: true,
          distanceMiles: true,
          createdAt: true
        }
      });
      const totalGarminRides = await prisma.ride.count({
        where: {
          userId,
          garminActivityId: { not: null }
        }
      });
      return res.json({
        success: true,
        recentRides: recentGarminRides,
        totalGarminRides,
        message: `Found ${recentGarminRides.length} recent Garmin rides (last 30 days), ${totalGarminRides} total`
      });
    } catch (error) {
      console.error("[Garmin Backfill Status] Error:", error);
      return res.status(500).json({ error: "Failed to fetch backfill status" });
    }
  }
);
function extractMinStartDate(errorText) {
  try {
    const parsed = JSON.parse(errorText);
    const message = typeof parsed?.errorMessage === "string" ? parsed.errorMessage : String(parsed ?? "");
    const match = message.match(/min start time of ([0-9T:.-]+Z)/i);
    if (match && match[1]) {
      const dt = new Date(match[1]);
      if (!Number.isNaN(dt.getTime())) {
        return dt;
      }
    }
  } catch (err) {
  }
  return null;
}
const r$4 = express.Router();
r$4.get(
  "/strava/backfill/fetch",
  async (req, res) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    try {
      const days = parseInt(req.query.days || "30", 10);
      if (isNaN(days) || days < 1 || days > 365) {
        return res.status(400).json({ error: "Days must be between 1 and 365" });
      }
      const accessToken = await getValidStravaToken(userId);
      if (!accessToken) {
        return res.status(400).json({
          error: "Strava not connected or token expired. Please reconnect your Strava account."
        });
      }
      const endDate = /* @__PURE__ */ new Date();
      const startDate = dateFns.subDays(endDate, days);
      const afterTimestamp = Math.floor(startDate.getTime() / 1e3);
      const beforeTimestamp = Math.floor(endDate.getTime() / 1e3);
      console.log(`[Strava Backfill] Fetching activities from ${startDate.toISOString()} to ${endDate.toISOString()}`);
      const activities = [];
      let page = 1;
      const perPage = 50;
      let hasMore = true;
      while (hasMore) {
        const url = new URL("https://www.strava.com/api/v3/athlete/activities");
        url.searchParams.set("after", afterTimestamp.toString());
        url.searchParams.set("before", beforeTimestamp.toString());
        url.searchParams.set("page", page.toString());
        url.searchParams.set("per_page", perPage.toString());
        const activitiesRes = await fetch(url.toString(), {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json"
          }
        });
        if (!activitiesRes.ok) {
          const text = await activitiesRes.text();
          console.error(`[Strava Backfill] Failed to fetch activities: ${activitiesRes.status} ${text}`);
          throw new Error(`Failed to fetch activities: ${activitiesRes.status}`);
        }
        const pageActivities = await activitiesRes.json();
        activities.push(...pageActivities);
        console.log(`[Strava Backfill] Fetched page ${page}: ${pageActivities.length} activities`);
        if (pageActivities.length < perPage) {
          hasMore = false;
        } else {
          page++;
        }
        if (page > 10) {
          console.warn("[Strava Backfill] Reached page limit (10), stopping pagination");
          hasMore = false;
        }
      }
      console.log(`[Strava Backfill] Total activities fetched: ${activities.length}`);
      const CYCLING_SPORT_TYPES = [
        "Ride",
        "MountainBikeRide",
        "GravelRide",
        "VirtualRide",
        "EBikeRide",
        "EMountainBikeRide",
        "Handcycle"
      ];
      const cyclingActivities = activities.filter(
        (a) => CYCLING_SPORT_TYPES.includes(a.sport_type)
      );
      console.log(`[Strava Backfill] Cycling activities: ${cyclingActivities.length}`);
      let importedCount = 0;
      let skippedCount = 0;
      for (const activity of cyclingActivities) {
        const existing = await prisma.ride.findUnique({
          where: { stravaActivityId: activity.id.toString() }
        });
        if (existing) {
          skippedCount++;
          continue;
        }
        let bikeId = null;
        if (activity.gear_id) {
          const mapping = await prisma.stravaGearMapping.findUnique({
            where: {
              userId_stravaGearId: {
                userId,
                stravaGearId: activity.gear_id
              }
            }
          });
          bikeId = mapping?.bikeId ?? null;
        }
        if (!bikeId) {
          const userBikes = await prisma.bike.findMany({
            where: { userId },
            select: { id: true }
          });
          if (userBikes.length === 1) {
            bikeId = userBikes[0].id;
          }
        }
        const distanceMiles = activity.distance * 621371e-9;
        const elevationGainFeet = activity.total_elevation_gain * 3.28084;
        const startTime = new Date(activity.start_date);
        const durationHours = Math.max(0, activity.moving_time) / 3600;
        const autoLocation = deriveLocation({
          city: activity.location_city ?? null,
          state: activity.location_state ?? null,
          country: activity.location_country ?? null,
          lat: activity.start_latlng?.[0] ?? null,
          lon: activity.start_latlng?.[1] ?? null
        });
        await prisma.$transaction(async (tx) => {
          await tx.ride.create({
            data: {
              userId,
              stravaActivityId: activity.id.toString(),
              stravaGearId: activity.gear_id ?? null,
              startTime,
              durationSeconds: activity.moving_time,
              distanceMiles,
              elevationGainFeet,
              averageHr: activity.average_heartrate ? Math.round(activity.average_heartrate) : null,
              rideType: activity.sport_type,
              notes: activity.name || null,
              bikeId,
              location: autoLocation
            }
          });
          if (bikeId && durationHours > 0) {
            await tx.component.updateMany({
              where: { userId, bikeId },
              data: { hoursUsed: { increment: durationHours } }
            });
          }
        });
        importedCount++;
      }
      console.log(`[Strava Backfill] Imported: ${importedCount}, Skipped (existing): ${skippedCount}`);
      const unmappedGearIds = cyclingActivities.filter((a) => a.gear_id).map((a) => a.gear_id).filter((id, idx, arr) => arr.indexOf(id) === idx);
      const unmappedGears = [];
      for (const gearId of unmappedGearIds) {
        const mapping = await prisma.stravaGearMapping.findUnique({
          where: {
            userId_stravaGearId: { userId, stravaGearId: gearId }
          }
        });
        if (!mapping) {
          const rideCount = cyclingActivities.filter((a) => a.gear_id === gearId).length;
          unmappedGears.push({ gearId, rideCount });
        }
      }
      console.log(`[Strava Backfill] Unmapped gears: ${unmappedGears.length}`);
      return res.json({
        success: true,
        message: `Successfully imported ${importedCount} rides from Strava.`,
        totalActivities: activities.length,
        cyclingActivities: cyclingActivities.length,
        imported: importedCount,
        skipped: skippedCount,
        unmappedGears
      });
    } catch (error) {
      console.error("[Strava Backfill] Error:", error);
      return res.status(500).json({ error: "Failed to fetch activities" });
    }
  }
);
r$4.get(
  "/strava/backfill/strava-athlete-id",
  async (req, res) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    try {
      const userAccount = await prisma.userAccount.findFirst({
        where: {
          userId,
          provider: "strava"
        },
        select: {
          providerUserId: true
        }
      });
      if (!userAccount) {
        return res.status(404).json({ error: "Strava account not connected" });
      }
      return res.json({
        stravaAthleteId: userAccount.providerUserId,
        message: "Your Strava athlete ID"
      });
    } catch (error) {
      console.error("[Strava Athlete ID] Error:", error);
      return res.status(500).json({ error: "Failed to fetch Strava athlete ID" });
    }
  }
);
r$4.get(
  "/strava/backfill/status",
  async (req, res) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    try {
      const thirtyDaysAgo = dateFns.subDays(/* @__PURE__ */ new Date(), 30);
      const recentStravaRides = await prisma.ride.findMany({
        where: {
          userId,
          stravaActivityId: { not: null },
          startTime: { gte: thirtyDaysAgo }
        },
        orderBy: { startTime: "desc" },
        take: 50,
        select: {
          id: true,
          stravaActivityId: true,
          startTime: true,
          rideType: true,
          distanceMiles: true,
          createdAt: true
        }
      });
      const totalStravaRides = await prisma.ride.count({
        where: {
          userId,
          stravaActivityId: { not: null }
        }
      });
      return res.json({
        success: true,
        recentRides: recentStravaRides,
        totalStravaRides,
        message: `Found ${recentStravaRides.length} recent Strava rides (last 30 days), ${totalStravaRides} total`
      });
    } catch (error) {
      console.error("[Strava Backfill Status] Error:", error);
      return res.status(500).json({ error: "Failed to fetch backfill status" });
    }
  }
);
r$4.get(
  "/strava/gear/:gearId",
  async (req, res) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    try {
      const { gearId } = req.params;
      const accessToken = await getValidStravaToken(userId);
      if (!accessToken) {
        return res.status(400).json({ error: "Strava not connected" });
      }
      const gearUrl = `https://www.strava.com/api/v3/gear/${gearId}`;
      const gearRes = await fetch(gearUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json"
        }
      });
      if (!gearRes.ok) {
        return res.status(404).json({ error: "Gear not found" });
      }
      const gear = await gearRes.json();
      return res.json({
        id: gear.id,
        name: gear.name,
        brand: gear.brand_name,
        model: gear.model_name
      });
    } catch (error) {
      console.error("[Strava Gear] Error:", error);
      return res.status(500).json({ error: "Failed to fetch gear" });
    }
  }
);
r$4.delete(
  "/strava/testing/delete-imported-rides",
  async (req, res) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    try {
      const rides = await prisma.ride.findMany({
        where: {
          userId,
          stravaActivityId: { not: null }
        },
        select: { id: true, durationSeconds: true, bikeId: true }
      });
      if (rides.length === 0) {
        return res.json({
          success: true,
          deletedRides: 0,
          message: "No Strava rides to delete"
        });
      }
      const hoursByBike = rides.reduce((map, ride) => {
        if (ride.bikeId) {
          const hours = Math.max(0, ride.durationSeconds ?? 0) / 3600;
          map.set(ride.bikeId, (map.get(ride.bikeId) ?? 0) + hours);
        }
        return map;
      }, /* @__PURE__ */ new Map());
      await prisma.$transaction(async (tx) => {
        for (const [bikeId, hours] of hoursByBike.entries()) {
          if (hours <= 0) continue;
          await tx.component.updateMany({
            where: { userId, bikeId },
            data: { hoursUsed: { decrement: hours } }
          });
          await tx.component.updateMany({
            where: { userId, bikeId, hoursUsed: { lt: 0 } },
            data: { hoursUsed: 0 }
          });
        }
        await tx.ride.deleteMany({
          where: {
            userId,
            stravaActivityId: { not: null }
          }
        });
      });
      return res.json({
        success: true,
        deletedRides: rides.length,
        adjustedBikes: hoursByBike.size
      });
    } catch (error) {
      console.error("[Strava Delete Rides] Error:", error);
      return res.status(500).json({ error: "Failed to delete Strava rides" });
    }
  }
);
const r$3 = express.Router();
r$3.get(
  "/data-source/preference",
  async (req, res) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { activeDataSource: true }
      });
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      return res.json({
        success: true,
        activeDataSource: user.activeDataSource
      });
    } catch (error) {
      console.error("[Data Source] Error fetching preference:", error);
      return res.status(500).json({ error: "Failed to fetch data source preference" });
    }
  }
);
r$3.post(
  "/data-source/preference",
  async (req, res) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const { provider } = req.body;
    if (!provider || provider !== "garmin" && provider !== "strava") {
      return res.status(400).json({ error: 'Invalid provider. Must be "garmin" or "strava"' });
    }
    try {
      const userAccount = await prisma.userAccount.findFirst({
        where: {
          userId,
          provider
        }
      });
      if (!userAccount) {
        return res.status(400).json({
          error: `${provider.charAt(0).toUpperCase() + provider.slice(1)} account not connected`
        });
      }
      await prisma.user.update({
        where: { id: userId },
        data: { activeDataSource: provider }
      });
      console.log(`[Data Source] User ${userId} set active source to ${provider}`);
      return res.json({
        success: true,
        activeDataSource: provider,
        message: `Active data source set to ${provider.charAt(0).toUpperCase() + provider.slice(1)}`
      });
    } catch (error) {
      console.error("[Data Source] Error setting preference:", error);
      return res.status(500).json({ error: "Failed to set data source preference" });
    }
  }
);
const r$2 = express.Router();
r$2.get("/duplicates", async (req, res) => {
  const userId = req.user?.id || req.sessionUser?.uid;
  if (!userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  try {
    const ridesWithDuplicates = await prisma.ride.findMany({
      where: {
        userId,
        duplicates: {
          some: {}
        }
      },
      include: {
        duplicates: {
          select: {
            id: true,
            startTime: true,
            durationSeconds: true,
            distanceMiles: true,
            elevationGainFeet: true,
            garminActivityId: true,
            stravaActivityId: true,
            rideType: true,
            notes: true,
            createdAt: true
          }
        }
      },
      orderBy: { startTime: "desc" }
    });
    return res.json({
      success: true,
      duplicates: ridesWithDuplicates
    });
  } catch (error) {
    console.error("[Duplicates] Error fetching:", error);
    return res.status(500).json({ error: "Failed to fetch duplicates" });
  }
});
r$2.post(
  "/duplicates/merge",
  async (req, res) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const { keepRideId, deleteRideId } = req.body;
    if (!keepRideId || !deleteRideId) {
      return res.status(400).json({ error: "Missing keepRideId or deleteRideId" });
    }
    try {
      const [keepRide, deleteRide] = await Promise.all([
        prisma.ride.findUnique({ where: { id: keepRideId }, select: { userId: true } }),
        prisma.ride.findUnique({ where: { id: deleteRideId }, select: { userId: true } })
      ]);
      if (!keepRide || !deleteRide) {
        return res.status(404).json({ error: "One or both rides not found" });
      }
      if (keepRide.userId !== userId || deleteRide.userId !== userId) {
        return res.status(403).json({ error: "Unauthorized" });
      }
      await prisma.ride.delete({
        where: { id: deleteRideId }
      });
      await prisma.ride.update({
        where: { id: keepRideId },
        data: {
          isDuplicate: false,
          duplicateOfId: null
        }
      });
      console.log(`[Duplicates] Merged: kept ${keepRideId}, deleted ${deleteRideId}`);
      return res.json({
        success: true,
        message: "Rides merged successfully",
        keptRideId: keepRideId
      });
    } catch (error) {
      console.error("[Duplicates] Error merging:", error);
      return res.status(500).json({ error: "Failed to merge rides" });
    }
  }
);
r$2.post(
  "/duplicates/mark-not-duplicate",
  async (req, res) => {
    const userId = req.user?.id || req.sessionUser?.uid;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const { rideId } = req.body;
    try {
      const ride = await prisma.ride.findUnique({
        where: { id: rideId },
        select: { userId: true, duplicateOfId: true }
      });
      if (!ride) {
        return res.status(404).json({ error: "Ride not found" });
      }
      if (ride.userId !== userId) {
        return res.status(403).json({ error: "Unauthorized" });
      }
      await prisma.ride.update({
        where: { id: rideId },
        data: {
          isDuplicate: false,
          duplicateOfId: null
        }
      });
      return res.json({
        success: true,
        message: "Ride marked as not duplicate"
      });
    } catch (error) {
      console.error("[Duplicates] Error marking:", error);
      return res.status(500).json({ error: "Failed to update ride" });
    }
  }
);
const API_BASE = (process.env.GARMIN_API_BASE || "").replace(/\/$/, "");
const TOKEN_URL = process.env.GARMIN_TOKEN_URL || "";
const CLIENT_ID = process.env.GARMIN_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GARMIN_CLIENT_SECRET;
async function getToken(userId) {
  const t = await prisma.oauthToken.findUnique({
    where: { userId_provider: { userId, provider: "garmin" } },
    select: { accessToken: true, refreshToken: true, expiresAt: true }
  });
  return t ?? null;
}
function isExpiringSoon(expiresAt, skewSeconds = 60) {
  return Date.now() + skewSeconds * 1e3 >= new Date(expiresAt).getTime();
}
async function saveToken(userId, tok) {
  const data = {
    accessToken: tok.accessToken,
    expiresAt: tok.expiresAt,
    // only include the field if you actually want to change it
    ...tok.refreshToken !== void 0 ? { refreshToken: tok.refreshToken } : {}
  };
  await prisma.oauthToken.update({
    where: { userId_provider: { userId, provider: "garmin" } },
    data
  });
}
async function refreshAccessToken(userId, current) {
  if (!current.refreshToken) {
    throw new Error("No refresh token available");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: current.refreshToken,
    client_id: CLIENT_ID
  });
  if (CLIENT_SECRET) body.set("client_secret", CLIENT_SECRET);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Garmin refresh failed: ${res.status} ${txt}`);
  }
  const j = await res.json();
  const nextRefresh = j.refresh_token !== void 0 ? j.refresh_token ?? null : void 0;
  const next = {
    accessToken: j.access_token,
    refreshToken: nextRefresh ?? current.refreshToken ?? null,
    expiresAt: new Date(Date.now() + (j.expires_in ?? 3600) * 1e3)
  };
  await saveToken(userId, { ...next, refreshToken: nextRefresh ?? current.refreshToken ?? null });
  return next;
}
async function getAccessToken(userId) {
  const rec = await getToken(userId);
  if (!rec) throw new Error("No Garmin token for user");
  if (isExpiringSoon(rec.expiresAt)) {
    const refreshed = await refreshAccessToken(userId, rec);
    return refreshed.accessToken;
  }
  return rec.accessToken;
}
function buildUrl(path, query) {
  const p = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(API_BASE + p);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return url.toString();
}
async function apiGet(userId, path, query) {
  let token = await getAccessToken(userId);
  let res = await fetch(buildUrl(path, query), {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" }
  });
  if (res.status === 401 || res.status === 403) {
    const rec = await getToken(userId);
    if (rec) {
      const refreshed = await refreshAccessToken(userId, rec);
      token = refreshed.accessToken;
      res = await fetch(buildUrl(path, query), {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" }
      });
    }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Garmin API error ${res.status}: ${text}`);
  }
  return await res.json();
}
async function garminGetActivities(userId, params) {
  return apiGet(userId, "/activities", params);
}
const r$1 = express.Router();
const requireUser = (req, res, next) => {
  if (!req.user?.id) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }
  next();
};
r$1.get(
  "/me/garmin/activities",
  requireUser,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const parsedLimit = Number.isFinite(Number(req.query.limit)) ? Math.min(100, Math.max(1, Number(req.query.limit))) : 5;
      const params = { limit: String(parsedLimit) };
      if (req.query.from) params.from = req.query.from;
      if (req.query.to) params.to = req.query.to;
      const data = await garminGetActivities(userId, params);
      res.status(200).json({ ok: true, data });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "failed";
      res.status(502).json({ ok: false, error: msg });
      return;
    }
  }
);
const r = express.Router();
const consentHtml = (redirectUrl) => `
<!doctype html><meta charset="utf-8">
<title>Mock Garmin Consent</title>
<div style="font-family:sans-serif;max-width:560px;margin:40px auto">
  <h2>Mock Garmin Authorization</h2>
  <p>This simulates Garmin's consent page. Click approve to continue.</p>
  <a href="${redirectUrl}" style="display:inline-block;padding:10px 16px;border:1px solid #ccc;border-radius:8px;text-decoration:none">Approve</a>
</div>
`;
r.get("/mock/garmin/authorize", (req, res) => {
  const { redirect_uri, state } = req.query;
  if (!redirect_uri) return res.status(400).send("missing redirect_uri");
  const code = `mockcode_${Date.now()}`;
  const back = new URL(redirect_uri);
  if (state) back.searchParams.set("state", state);
  back.searchParams.set("code", code);
  return res.status(200).send(consentHtml(back.toString()));
});
r.post("/mock/garmin/token", async (req, res) => {
  const grantType = req.body?.grant_type || "authorization_code";
  if (grantType === "authorization_code") {
    return res.json({
      access_token: `mock_access_${Date.now()}`,
      refresh_token: `mock_refresh_${Date.now()}`,
      token_type: "Bearer",
      expires_in: 3600,
      scope: req.body?.scope ?? "activity:read"
    });
  }
  if (grantType === "refresh_token") {
    return res.json({
      access_token: `mock_access_${Date.now()}`,
      refresh_token: req.body?.refresh_token || `mock_refresh_${Date.now()}`,
      token_type: "Bearer",
      expires_in: 3600
    });
  }
  return res.status(400).json({ error: "unsupported_grant_type" });
});
r.get("/mock/garmin/api/activities", (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 5)));
  const now = Date.now();
  const mk = (i) => ({
    id: `mock-${i}`,
    startTime: new Date(now - i * 864e5).toISOString(),
    duration: 3600 + i * 123,
    // seconds
    distance: 2e4 + i * 321,
    // meters
    elevationGain: 600 + i * 50
    // meters
  });
  const data = Array.from({ length: limit }, (_, i) => mk(i + 1));
  return res.json(data);
});
const router$3 = express.Router();
router$3.post("/complete", express.json(), async (req, res) => {
  try {
    const sessionUser = req.sessionUser;
    if (!sessionUser?.uid) {
      return res.status(401).json({ message: "Unauthorized: No active session" });
    }
    const { age, location, bikeYear, bikeMake, bikeModel, components } = req.body;
    if (!bikeMake || !bikeModel) {
      return res.status(400).json({ message: "Bike make and model are required" });
    }
    if (age && (age < 16 || age > 150)) {
      return res.status(400).json({ message: "Please enter a valid age" });
    }
    const userId = sessionUser.uid;
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: {
          age: age || null,
          location: location || null,
          onboardingCompleted: true
        }
      });
      console.log(`[Onboarding] Updated user profile for: ${userId}`);
      const bike = await tx.bike.create({
        data: {
          userId,
          manufacturer: bikeMake,
          model: bikeModel,
          year: bikeYear || null
        }
      });
      console.log(`[Onboarding] Created bike for user: ${userId}`);
      const componentTypeMap = {
        fork: "FORK",
        rearShock: "SHOCK",
        wheels: "WHEELS",
        dropperPost: "DROPPER"
      };
      if (components) {
        for (const [key, value] of Object.entries(components)) {
          if (value && value.trim().length > 0) {
            const componentType = componentTypeMap[key];
            if (componentType) {
              const [brand, ...modelParts] = value.trim().split(" ");
              const model = modelParts.join(" ") || brand;
              await tx.component.create({
                data: {
                  userId,
                  bikeId: bike.id,
                  type: componentType,
                  brand,
                  model,
                  hoursUsed: 0
                }
              });
              console.log(`[Onboarding] Created ${componentType} component for bike: ${bike.id}`);
            }
          }
        }
      }
      await tx.component.create({
        data: {
          userId,
          bikeId: bike.id,
          type: "PIVOT_BEARINGS",
          brand: "Stock",
          model: "Stock",
          hoursUsed: 0,
          isStock: true
        }
      });
      console.log(`[Onboarding] Created stock Pivot Bearings component for bike: ${bike.id}`);
      return { user, bike };
    });
    res.status(200).json({
      ok: true,
      message: "Onboarding completed successfully",
      bikeId: result.bike.id
    });
  } catch (error) {
    console.error("[Onboarding] Error completing onboarding:", error);
    res.status(500).json({
      message: "An error occurred while completing onboarding. Please try again."
    });
  }
});
const normalizeEmail = (email) => (email ?? "").trim().toLowerCase() || null;
const isBetaTester = (email) => {
  const betaTesterEmails = (process.env.BETA_TESTER_EMAILS ?? "").split(",").map((e) => normalizeEmail(e)).filter((e) => e !== null);
  const normalizedEmail = normalizeEmail(email);
  return normalizedEmail ? betaTesterEmails.includes(normalizedEmail) : false;
};
async function ensureUserFromGoogle(claims, tokens) {
  const sub = claims.sub;
  if (!sub) throw new Error("Google sub is required");
  const email = normalizeEmail(claims.email);
  if (!email) throw new Error("Google login did not provide an email");
  if (process.env.BETA_TESTER_EMAILS) {
    if (!isBetaTester(email)) {
      throw new Error("NOT_BETA_TESTER");
    }
  }
  return prisma.$transaction(async (tx) => {
    const existingAccount = await tx.userAccount.findUnique({
      where: { provider_providerUserId: { provider: "google", providerUserId: sub } },
      include: { user: true }
    });
    if (existingAccount) {
      await refresh(tx, existingAccount.user.id, claims);
      return existingAccount.user;
    }
    let user = await tx.user.findUnique({ where: { email } });
    if (!user) {
      try {
        user = await tx.user.create({
          data: {
            email,
            name: claims.name ?? "",
            avatarUrl: claims.picture ?? null,
            emailVerified: claims.email_verified ? /* @__PURE__ */ new Date() : null
          }
        });
      } catch (e) {
        if (e instanceof client$1.Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          user = await tx.user.findUniqueOrThrow({ where: { email } });
        } else {
          throw e;
        }
      }
    } else {
      await tx.user.update({
        where: { id: user.id },
        data: {
          name: claims.name ?? void 0,
          avatarUrl: claims.picture ?? void 0,
          emailVerified: claims.email_verified ? /* @__PURE__ */ new Date() : void 0
        }
      });
    }
    try {
      await tx.userAccount.create({
        data: { userId: user.id, provider: "google", providerUserId: sub }
      });
    } catch (e) {
      if (!(e instanceof client$1.Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    }
    return user;
  });
}
async function refresh(tx, userId, claims, tokens) {
  await tx.user.update({
    where: { id: userId },
    data: {
      name: claims.name ?? void 0,
      avatarUrl: claims.picture ?? void 0,
      emailVerified: claims.email_verified ? /* @__PURE__ */ new Date() : void 0
    }
  });
}
const { SESSION_SECRET } = process.env;
function setSessionCookie(res, payload) {
  const token = jwt.sign(payload, SESSION_SECRET, { expiresIn: "7d" });
  res.cookie("ll_session", token, {
    httpOnly: true,
    secure: process.env.APP_ENV === "production",
    sameSite: process.env.APP_ENV === "production" ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1e3
  });
}
function clearSessionCookie(res) {
  res.clearCookie("ll_session", {
    httpOnly: true,
    secure: process.env.APP_ENV === "production",
    sameSite: "lax"
  });
}
function attachUser(req, _res, next) {
  const token = req.cookies?.ll_session;
  if (!token) return next();
  try {
    const user = jwt.verify(token, SESSION_SECRET);
    req.sessionUser = user;
  } catch {
  }
  next();
}
const router$2 = express.Router();
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error("[GoogleAuth] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET");
}
const client = new googleAuthLibrary.OAuth2Client({
  clientId: GOOGLE_CLIENT_ID,
  clientSecret: GOOGLE_CLIENT_SECRET,
  redirectUri: "postmessage"
});
router$2.post("/google/code", express.json(), async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).send("Missing credential");
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID
    });
    const p = ticket.getPayload();
    if (!p?.sub) return res.status(401).send("Invalid Google token");
    const user = await ensureUserFromGoogle(
      {
        sub: p.sub,
        email: p.email ?? void 0,
        email_verified: p.email_verified,
        name: p.name,
        picture: p.picture
      }
    );
    setSessionCookie(res, { uid: user.id, email: user.email });
    res.status(200).json({ ok: true });
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    console.error("[GoogleAuth] ID-token login failed", e);
    if (errorMessage === "NOT_BETA_TESTER") {
      return res.status(403).send("NOT_BETA_TESTER");
    }
    res.status(500).send("Auth failed");
  }
});
router$2.post("/logout", (_req, res) => {
  console.log("[GoogleAuth] Logout request");
  clearSessionCookie(res);
  res.status(200).json({ ok: true });
});
const SALT_ROUNDS = 12;
async function hashPassword(password) {
  return bcryptjs.hash(password, SALT_ROUNDS);
}
async function verifyPassword(password, hash) {
  return bcryptjs.compare(password, hash);
}
function validatePassword(password) {
  if (password.length < 8) {
    return { isValid: false, error: "Password must be at least 8 characters" };
  }
  if (!/[A-Z]/.test(password)) {
    return {
      isValid: false,
      error: "Password must contain at least one uppercase letter"
    };
  }
  if (!/[a-z]/.test(password)) {
    return {
      isValid: false,
      error: "Password must contain at least one lowercase letter"
    };
  }
  if (!/[0-9]/.test(password)) {
    return { isValid: false, error: "Password must contain at least one number" };
  }
  if (!/[!@#$%^&*]/.test(password)) {
    return {
      isValid: false,
      error: "Password must contain at least one special character (!@#$%^&*)"
    };
  }
  return { isValid: true };
}
function validateEmailFormat(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}
const router$1 = express.Router();
router$1.post("/signup", express.json(), async (req, res) => {
  try {
    const { email: rawEmail, password, name } = req.body;
    if (!rawEmail || !password) {
      return res.status(400).send("Email and password are required");
    }
    if (!name || name.trim().length === 0) {
      return res.status(400).send("Name is required");
    }
    const email = normalizeEmail(rawEmail);
    if (!email) {
      return res.status(400).send("Invalid email");
    }
    if (!validateEmailFormat(email)) {
      return res.status(400).send("Invalid email format");
    }
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      return res.status(400).send(passwordValidation.error);
    }
    if (process.env.BETA_TESTER_EMAILS) {
      if (!isBetaTester(email)) {
        return res.status(403).send("NOT_BETA_TESTER");
      }
    }
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name: name.trim(),
        onboardingCompleted: false
      }
    });
    setSessionCookie(res, { uid: user.id, email: user.email });
    res.status(200).json({ ok: true });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[EmailAuth] Signup failed", e);
    if (error.includes("Unique constraint failed")) {
      return res.status(409).send("Email already in use");
    }
    res.status(500).send("Signup failed");
  }
});
router$1.post("/login", express.json(), async (req, res) => {
  try {
    const { email: rawEmail, password } = req.body;
    if (!rawEmail || !password) {
      return res.status(400).send("Email and password are required");
    }
    const email = normalizeEmail(rawEmail);
    if (!email) {
      return res.status(400).send("Invalid email");
    }
    const user = await prisma.user.findUnique({
      where: { email }
    });
    if (!user) {
      return res.status(401).send("Invalid email or password");
    }
    if (!user.passwordHash) {
      return res.status(401).send("This account uses OAuth login only");
    }
    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).send("Invalid email or password");
    }
    if (process.env.BETA_TESTER_EMAILS) {
      if (!isBetaTester(email)) {
        return res.status(403).send("NOT_BETA_TESTER");
      }
    }
    setSessionCookie(res, { uid: user.id, email: user.email });
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[EmailAuth] Login failed", e);
    res.status(500).send("Login failed");
  }
});
const router = express.Router();
router.delete("/delete-account", async (req, res) => {
  try {
    const sessionUser = req.sessionUser;
    if (!sessionUser?.uid) {
      return res.status(401).json({ message: "Unauthorized: No active session" });
    }
    const userId = sessionUser.uid;
    console.log(`[DeleteAccount] Deleting account and data for user: ${userId}`);
    await prisma.ride.deleteMany({
      where: { userId }
    });
    console.log(`[DeleteAccount] Deleted rides for user: ${userId}`);
    await prisma.component.deleteMany({
      where: { userId }
    });
    console.log(`[DeleteAccount] Deleted components for user: ${userId}`);
    await prisma.bike.deleteMany({
      where: { userId }
    });
    console.log(`[DeleteAccount] Deleted bikes for user: ${userId}`);
    await prisma.oauthToken.deleteMany({
      where: { userId }
    });
    console.log(`[DeleteAccount] Deleted OAuth tokens for user: ${userId}`);
    await prisma.userAccount.deleteMany({
      where: { userId }
    });
    console.log(`[DeleteAccount] Deleted user accounts for user: ${userId}`);
    const deletedUser = await prisma.user.delete({
      where: { id: userId }
    });
    console.log(`[DeleteAccount] Successfully deleted user: ${deletedUser.email}`);
    clearSessionCookie(res);
    res.status(200).json({
      ok: true,
      message: "Account successfully deleted"
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[DeleteAccount] Error deleting account:", error);
    if (errorMessage.includes("An operation failed because it depends on one or more records")) {
      return res.status(400).json({
        message: "Failed to delete account: Some data could not be removed"
      });
    }
    res.status(500).json({
      message: "An error occurred while deleting your account. Please try again."
    });
  }
});
const startServer = async () => {
  const app = express();
  app.set("trust proxy", 1);
  app.get("/health", (_req, res) => res.status(200).send("ok"));
  const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
  const EXTRA_ORIGINS = (process.env.CORS_EXTRA_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const allowOrigin = (origin) => {
    if (!origin) return true;
    try {
      const u = new URL(origin);
      const host = u.hostname;
      return origin === FRONTEND_URL || origin === "http://localhost:5173" || EXTRA_ORIGINS.includes(origin) || host.endsWith(".vercel.app");
    } catch {
      return false;
    }
  };
  const corsMw = cors({
    origin(origin, cb) {
      if (allowOrigin(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  });
  app.use(corsMw);
  app.options("*", corsMw);
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser(process.env.COOKIE_SECRET || "dev-secret"));
  app.use((req, res, next) => {
    if (req.path === "/graphql" || req.path.startsWith("/auth")) {
      console.log(`[REQ] ${req.method} ${req.path} origin=${req.headers.origin || "n/a"}`);
    }
    next();
  });
  app.use(attachUser);
  app.get("/whoami", (req, res) => {
    res.json({ sessionUser: req.sessionUser ?? null });
  });
  app.use("/auth", router$2);
  app.use("/auth", router$1);
  app.use("/auth", router);
  app.use("/auth", r$9);
  app.use("/auth", r$8);
  app.use("/api", r$5);
  app.use("/api", r$4);
  app.use("/api", r$3);
  app.use("/api", r$2);
  app.use(r$7);
  app.use(r$6);
  app.use("/onboarding", router$3);
  app.use(r$1);
  app.use(r);
  const server$1 = new server.ApolloServer({ typeDefs, resolvers });
  await server$1.start();
  app.use((req, _res, next) => {
    if (req.path === "/graphql" && req.method === "POST") {
      console.log("[GraphQL] sessionUser:", req.sessionUser ?? null);
    }
    next();
  });
  app.use(
    "/graphql",
    express4.expressMiddleware(server$1, {
      context: async ({ req, res }) => {
        const legacy = req.user;
        const sess = req.sessionUser;
        const user = legacy ?? (sess ? { id: sess.uid, email: sess.email } : null);
        return { req, res, user: user ?? null };
      }
    })
  );
  const PORT = Number(process.env.PORT) || 4e3;
  const HOST = "0.0.0.0";
  app.listen(PORT, HOST, () => {
    console.log(`🚴 LoamLogger backend running on :${PORT} (GraphQL at /graphql)`);
  });
  process.on("SIGTERM", async () => {
    await server$1.stop();
    process.exit(0);
  });
};
startServer();
