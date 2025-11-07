"use strict";
require("dotenv/config");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const server = require("@apollo/server");
const express4 = require("@as-integrations/express4");
const graphqlTag = require("graphql-tag");
const client = require("@prisma/client");
const dateFns = require("date-fns");
const typeDefs = graphqlTag.gql`

  enum RideType {
    TRAIL
    ENDURO
    COMMUTE
    ROAD
    GRAVEL
    TRAINER
  }

  type Ride {
    id: ID!
    userId: ID!
    garminActivityId: String
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

  type Mutation {
    addRide(input: AddRideInput!): Ride!
    updateRide(id: ID!, input: UpdateRideInput!): Ride!
    deleteRide(id: ID!): DeleteRideResult!
  }

  type User {
    id: ID!
    email: String!
    rides: [Ride!]!
    name: String
  }

  type Query {
    me: User
    user(id: ID!): User
    rides(take: Int = 20, after: ID): [Ride!]!
    rideTypes: [RideType!]!
  }
`;
const prisma = global.__prisma__ ?? new client.PrismaClient();
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
const ALLOWED_RIDE_TYPES = [
  "TRAIL",
  "ENDURO",
  "COMMUTE",
  "ROAD",
  "GRAVEL",
  "TRAINER"
];
const resolvers = {
  Query: {
    user: (args) => prisma.user.findUnique({
      where: { id: args.id },
      include: { rides: true }
    }),
    rides: async (_, { take = 20, after }, ctx) => {
      if (!ctx.user?.id) throw new Error("Unauthorized");
      const limit = Math.min(100, Math.max(1, take));
      return prisma.ride.findMany({
        where: { userId: ctx.user.id },
        orderBy: { startTime: "desc" },
        take: limit,
        ...after ? { skip: 1, cursor: { id: after } } : {}
      });
    },
    rideTypes: () => ALLOWED_RIDE_TYPES,
    me: async (ctx) => {
      const id = ctx.user?.id;
      return id ? prisma.user.findUnique({ where: { id } }) : null;
    }
  },
  Mutation: {
    addRide: async (_p, { input }, ctx) => {
      if (!ctx.user?.id) throw new Error("Unauthorized");
      const start = parseIso(input.startTime);
      const durationSeconds = Math.max(0, Math.floor(input.durationSeconds));
      const distanceMiles = Math.max(0, Number(input.distanceMiles));
      const elevationGainFeet = Math.max(0, Number(input.elevationGainFeet));
      const averageHr = typeof input.averageHr === "number" ? Math.max(0, Math.floor(input.averageHr)) : null;
      const notes = cleanText(input.notes, MAX_NOTES_LEN);
      const trailSystem = cleanText(input.trailSystem, MAX_LABEL_LEN);
      const location = cleanText(input.location, MAX_LABEL_LEN);
      const rideType = cleanText(input.rideType, 32);
      if (!rideType) throw new Error("rideType is required");
      return prisma.ride.create({
        data: {
          userId: ctx.user.id,
          startTime: start,
          durationSeconds,
          distanceMiles,
          elevationGainFeet,
          averageHr,
          rideType,
          ...input.bikeId ? { bikeId: input.bikeId } : {},
          ...notes ? { notes } : {},
          ...trailSystem ? { trailSystem } : {},
          ...location ? { location } : {}
        }
      });
    },
    deleteRide: async (_, { id }, ctx) => {
      if (!ctx.user?.id) throw new Error("Unauthorized");
      const owned = await prisma.ride.findUnique({
        where: { id },
        select: { userId: true }
      });
      if (!owned || owned.userId !== ctx.user.id) {
        throw new Error("Ride not found");
      }
      await prisma.ride.delete({ where: { id } });
      return { ok: true, id };
    },
    updateRide: async (_parent, { id, input }, ctx) => {
      if (!ctx.user?.id) throw new Error("Unauthorized");
      const owned = await prisma.ride.findUnique({
        where: { id },
        select: { userId: true }
      });
      if (!owned || owned.userId !== ctx.user.id) throw new Error("Ride not found");
      const start = parseIsoOptionalStrict(input.startTime);
      const rideType = input.rideType === void 0 ? void 0 : cleanText(input.rideType, 32) || void 0;
      const notes = "notes" in input ? typeof input.notes === "string" ? cleanText(input.notes, MAX_NOTES_LEN) : null : void 0;
      const trailSystem = "trailSystem" in input ? typeof input.trailSystem === "string" ? cleanText(input.trailSystem, MAX_LABEL_LEN) : null : void 0;
      const location = "location" in input ? typeof input.location === "string" ? cleanText(input.location, MAX_LABEL_LEN) : null : void 0;
      const data = {
        ...start !== void 0 && { startTime: start },
        // Date (no null)
        ...input.durationSeconds !== void 0 && {
          durationSeconds: Math.max(0, Math.floor(input.durationSeconds ?? 0))
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
        ...input.bikeId !== void 0 && { bikeId: input.bikeId ?? null },
        // nullable
        ..."notes" in input ? { notes } : {},
        ..."trailSystem" in input ? { trailSystem } : {},
        ..."location" in input ? { location } : {}
      };
      const updated = await prisma.ride.update({
        where: { id },
        data
      });
      return updated;
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
const r$2 = express.Router();
r$2.get("/auth/garmin/start", async (_req, res) => {
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
r$2.get(
  "/auth/garmin/callback",
  async (req, res) => {
    const TOKEN_URL2 = process.env.GARMIN_TOKEN_URL;
    const REDIRECT_URI = process.env.GARMIN_REDIRECT_URI;
    const CLIENT_ID2 = process.env.GARMIN_CLIENT_ID;
    if (!TOKEN_URL2 || !REDIRECT_URI || !CLIENT_ID2) {
      const missing = [
        !TOKEN_URL2 && "GARMIN_TOKEN_URL",
        !REDIRECT_URI && "GARMIN_REDIRECT_URI",
        !CLIENT_ID2 && "GARMIN_CLIENT_ID"
      ].filter(Boolean).join(", ");
      return res.status(500).send(`Missing env vars: ${missing}`);
    }
    const { code, state } = req.query;
    const cookieState = req.cookies["ll_oauth_state"];
    const verifier = req.cookies["ll_pkce_verifier"];
    if (!code || !state || !cookieState || state !== cookieState || !verifier) {
      return res.status(400).send("Invalid OAuth state/PKCE");
    }
    if (!req.user?.id) return res.status(401).send("No user");
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
    await prisma.oauthToken.upsert({
      where: { userId_provider: { userId: req.user.id, provider: "garmin" } },
      create: {
        userId: req.user.id,
        provider: "garmin",
        accessToken: t.access_token,
        refreshToken: refreshTokenNorm,
        // OK with exactOptionalPropertyTypes
        expiresAt
      },
      update: {
        accessToken: t.access_token,
        expiresAt,
        // Only touch refreshToken if the field was present in the response
        ...t.refresh_token !== void 0 ? { refreshToken: t.refresh_token ?? null } : {}
      }
    });
    res.clearCookie("ll_oauth_state", { path: "/" });
    res.clearCookie("ll_pkce_verifier", { path: "/" });
    const appBase = process.env.APP_BASE_URL ?? "http://localhost:5173";
    return res.redirect(`${appBase.replace(/\/$/, "")}/auth/complete`);
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
const attachUser = async (req, res, next) => {
  try {
    const cookieId = req.signedCookies?.ll_uid;
    if (cookieId) {
      const u = await prisma.user.findUnique({
        where: { id: cookieId },
        select: { id: true, email: true, name: true }
      });
      if (u) {
        req.user = u;
        return next();
      }
    }
    const dev = await prisma.user.upsert({
      where: { email: "dev@example.com" },
      update: {},
      create: { email: "dev@example.com", name: "Dev User" },
      select: { id: true, email: true, name: true }
    });
    res.cookie("ll_uid", dev.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV !== "development",
      signed: true,
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1e3
    });
    req.user = dev;
    next();
  } catch (e) {
    next(e);
  }
};
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
const startServer = async () => {
  const app = express();
  app.use(
    cors({
      origin: process.env.APP_ORIGIN || "http://localhost:5173",
      credentials: true
    })
  );
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser(process.env.COOKIE_SECRET || "dev-secret"));
  app.use(attachUser);
  app.use(r$2);
  app.use(r$1);
  app.use(r);
  const server$1 = new server.ApolloServer({ typeDefs, resolvers });
  await server$1.start();
  app.use(
    "/graphql",
    express4.expressMiddleware(server$1, {
      context: async ({ req, res }) => ({
        req,
        res,
        user: req.user ?? null
        // typed via your global augmentation
      })
    })
  );
  app.get("/healthz", (_req, res) => res.send("ok"));
  const PORT = Number(process.env.PORT) || 4e3;
  app.listen(PORT, () => {
    console.log(`🚴 LoamLogger backend running at http://localhost:${PORT}/graphql`);
  });
};
startServer();
