# Lift Detection: Integration Plan

Status: proposal. Produced from a full codebase audit on 2026-07-18. No implementation
code exists yet; the reference `liftDetection.ts` is not in the repo and is treated as
a spec for the two detection layers.

---

## 1. Audit summary

Three findings materially change the shape of the work; everything else confirms the
brief's assumptions.

### Finding 1 — No per-point data exists anywhere. Stream ingestion is a prerequisite, not an adaptation.

No code calls Strava's `/activities/{id}/streams` endpoint (or any provider's
per-point API). Every import path consumes only the activity **summary**:
`distance`, `moving_time`, `total_elevation_gain`, `average_heartrate`,
`start_latlng`, `gear_id`, `sport_type` (`apps/api/src/workers/sync.worker.ts:76-93`,
`apps/api/src/routes/strava.backfill.ts:584-614`). The `Ride` model
(`apps/api/prisma/schema.prisma:106-143`) stores scalar summaries plus a single
`startLat`/`startLng`. There is no polyline, track, stream, or trackpoint storage of
any kind, and no GPX/FIT/JSON ride fixtures in the repo.

Consequence: Phase 0 of this plan is fetching and persisting Strava streams — new
API calls and a new table. Nothing in the detector can run until this lands.
(A decision recorded in §7 skips bulk re-fetching for historical rides entirely;
historical rides are analyzed only when the user explicitly marks one, §3.4.)

### Finding 2 — Wear is almost entirely duration-driven, which simplifies metric exclusion.

Two parallel wear systems exist:

- **`Component.hoursUsed`** (`schema.prisma:261`) — an incrementally mutated running
  total. Every import path calls `syncBikeComponentHours`
  (`apps/api/src/lib/component-hours.ts:56`), which credits
  `durationSeconds / 3600` equally to **every** installed component on the bike.
  Distance and elevation are ignored entirely.
- **Prediction engine** (`apps/api/src/services/prediction/`) — recomputed from ride
  history on demand (up to 2000 rides, `window.ts:150`), cached in Redis/memory for
  30 min (`cache.ts`). Its per-type multi-metric model (`wear.ts:61`,
  `config.ts:77`) uses distance/elevation/steepness — but only in PRO predictive
  mode with ≥MEDIUM confidence (`engine.ts:196-237`). The default path is again
  pure duration.

Consequence: excluding lift time flows overwhelmingly through `durationSeconds`.
The prediction engine needs **no backfill** — it recomputes from `Ride` rows; only
cache invalidation (`invalidateBikePrediction`) is required. `hoursUsed` can be
re-derived per component using the existing `recomputeComponentAfterServiceChange`
pattern (`resolvers.ts:306`).

### Finding 3 — No PostGIS, and it isn't needed.

No `CREATE EXTENSION` in any of the 70 migrations; coordinates are plain `Float`
columns. The API deploys to Railway via `nixpacks.toml`, with `prisma migrate deploy`
at container boot. Since a decided constraint is that detection must be a **pure
function** over points plus lift lines (testable without network or DB), the 40 m
buffer check is haversine math in TypeScript. PostGIS would add hosting risk
(Railway extension support verification, `Unsupported` Prisma types) for zero
benefit at this scale. **This plan does not enable PostGIS.**

### Condensed answers to the remaining audit questions

**Import pipeline.** Strava OAuth lands tokens in `OauthToken` (plaintext) and
`UserIntegration` (encrypted) via `apps/api/src/routes/auth.strava.ts`; refresh via
`getValidStravaToken` (`apps/api/src/lib/strava-token.ts:120`). Three import entry
points converge on `prisma.ride.upsert` keyed by the `@unique stravaActivityId`:

1. BullMQ sync worker (`apps/api/src/workers/sync.worker.ts` —
   `syncStravaLatest:214`, `syncStravaActivity:259`, `upsertStravaActivity:291`),
   queue in `apps/api/src/lib/queue/sync.queue.ts` (attempts: 5, exponential
   backoff, deterministic job IDs for dedup).
2. Strava webhook (`apps/api/src/routes/webhooks.strava.ts` —
   `processActivityEvent:190`, inline upsert at `:338`); one app-wide subscription
   with hub.challenge verification.
3. Historical backfill (`apps/api/src/routes/strava.backfill.ts:20`) — notably
   **synchronous within the HTTP request**, unlike Garmin/Suunto which use the
   backfill queue/worker.

Idempotency is solid: unique external-ID columns + upserts + deterministic BullMQ
job IDs. Known gap: component-hour crediting is a separate transaction from the ride
upsert on some paths; failures orphan hours (logged as `orphaned_component_hours`,
`sync.worker.ts:647`).

Garmin differs: REST/JSON push-only via PING/PULL webhooks
(`webhooks.garmin.ts:182`); no polling (forbidden by Garmin outside verification);
backfill is async via `backfill.worker.ts:156` with activities delivered back
through the webhook. No FIT parsing exists. Whoop and Suunto integrations also
exist; cross-provider dedup via `isActiveSource`
(`apps/api/src/lib/active-source.ts`) and `duplicate-detector.ts`.

**Data model.** Single schema at `apps/api/prisma/schema.prisma`, 32 models.
Aggregates (`distanceMeters`, `elevationGainMeters`, `durationSeconds`,
`averageHr`) are written at import time, copied verbatim from provider summaries.
User/bike totals are computed on read via Prisma `_sum` (`resolvers.ts:1640`,
bikeHistory `~1410-1690`). **No segment, lap, or sub-interval concept exists.**
Json-column caches for external APIs are an established pattern: `WeatherCache`
(keyed lat/lng/hour, `apps/api/src/lib/weather/cache.ts`) and `GeoCache`
(`apps/api/src/lib/location.ts`).

**Wear.** Covered in Finding 2. Ride delete/edit does adjust hours back
(`deleteRide` `resolvers.ts:1786`, `updateRide` `:1829`), but decrements floor at 0
(`component-hours.ts:37`), so repeated incremental adjustment can drift — a reason
to prefer recompute over diffing during backfill. Denormalized values that go stale
on retroactive change: `Component.hoursUsed`, `ServiceLog.hoursAtService`
snapshots, and the Redis `pred:*`/`advisor:*` caches. No leaderboards or yearly
summary tables exist.

**Surfaces.** Web metrics flow through the `RIDES` query
(`apps/web/src/graphql/rides.ts`) and `BIKE_HISTORY`
(`apps/web/src/graphql/bikeHistory.ts`), rendered by `RideStatsCard`,
`RideStatsCompact`, `RideCard`, `BikeHistory.tsx`, `SharedBikeHistory.tsx`, and the
PDF export. Client-side stats recompute live from the rides list
(`useRideStats.ts`, `rideStats.ts`), so adjusted per-ride values propagate to all
dashboard stats automatically. **There is no React Native app in this repo** (only
backend mobile-auth routes and planning docs; the client is external) and **no map
rendering or mapping library at all** — no OpenLayers setup exists. GraphQL is
schema-first: one SDL tagged template (`apps/api/src/graphql/schema.ts`, ~1160
lines) + one resolver object (`resolvers.ts`, ~5900 lines) + dataloaders.

**Infrastructure.** No shared outbound HTTP client — ad-hoc `fetch` per
integration; only Open-Meteo has a timeout (15 s AbortController + throttle,
`apps/api/src/lib/weather/open-meteo.ts:109`). That file is the template for the
Overpass client. Caching: Redis singleton with graceful degradation
(`src/lib/redis.ts`), in-memory fallbacks, and the Prisma-table cache pattern
above. Rate limiting is custom Redis-backed (`src/lib/rate-limit.ts`) including
outbound quotas (Suunto token bucket) and distributed locks. Tests: Jest +
co-located `*.test.ts`, `global.fetch = jest.fn()` for HTTP mocking, **zero ride
stream fixtures**. Background work: BullMQ workers (`sync`, `backfill`,
`notification`, `weather`) started from `server.ts:321` when `REDIS_URL` is set.
**No feature-flag framework** — env-var gates are the convention
(`GARMIN_VERIFICATION_MODE`).

---

## 2. Proposed data model changes

Three new models and three nullable delta columns on `Ride`. Raw provider values
are never overwritten (decided constraint), so everything below is additive and
reversible.

### 2.1 `RideStream` — persisted raw streams

```prisma
model RideStream {
  id            String   @id @default(uuid())
  rideId        String   @unique
  ride          Ride     @relation(fields: [rideId], references: [id], onDelete: Cascade)
  source        String   // "strava" — normalization is source-specific, storage is not
  pointCount    Int
  // Parallel arrays, one JSON payload: { time: number[], latlng: [number,number][],
  // altitude: number[], velocity: number[], cadence?: number[], heartrate?: number[],
  // moving?: boolean[] }
  data          Json
  fetchedAt     DateTime @default(now())
}
```

- **Stream keys requested from Strava:** `time,latlng,altitude,velocity_smooth,cadence,heartrate,moving`
  with `key_by_type=true`. Cadence and moving cost nothing extra to request and are
  needed later (cadence-absence is a Layer B signal; drivetrain "active pedaling
  time" needs cadence).
- **Storage cost:** a 3-hour ride at 1 s sampling is ~10k points ≈ 300–600 KB of
  JSON, and Postgres TOAST compresses Json columns transparently (lat/lng arrays
  compress well). At ~90 users, even 10k total rides is on the order of a few GB
  worst case — acceptable on Railway Postgres without a separate object store. If
  this ever matters, swap `data Json` for `data Bytes` (gzip) behind the same
  accessor; do not design for it now.
- One row per ride, `@unique rideId`, cascade delete — deleting a ride (e.g. via
  the Strava delete webhook) removes its stream automatically. Note the cascade
  alone does not cover disconnect: per the decision in §7, rides survive
  deauthorization while streams are deleted, so the deauth webhook and disconnect
  path must delete `RideStream` rows explicitly.

### 2.2 `RideSegment` — detected lift segments

```prisma
enum RideSegmentKind {
  LIFT
}

model RideSegment {
  id               String          @id @default(uuid())
  rideId           String
  ride             Ride            @relation(fields: [rideId], references: [id], onDelete: Cascade)
  kind             RideSegmentKind
  startIndex       Int             // index into RideStream.data arrays
  endIndex         Int             // inclusive
  startTime        DateTime        // denormalized for display/debugging without loading the stream
  endTime          DateTime
  confidence       Float           // combined score, 0..1
  geometryScore    Float?          // null when Overpass was unavailable — auditable degradation
  kinematicScore   Float
  liftName         String?         // OSM name of matched aerialway, if any
  liftOsmId        String?
  // Deltas this segment removes from ride metrics, precomputed at detection time
  durationSeconds  Int
  elevationGainMeters Float
  distanceMeters   Float
  detectorVersion  Int             // bump when thresholds change; enables selective re-detection
  createdAt        DateTime        @default(now())

  @@index([rideId])
}
```

**Indices versus duplicated geometry:** segments store `startIndex`/`endIndex` into
the stream rather than copying coordinates because (a) the raw stream is immutable
by decision, so indices can never dangle or diverge; (b) a segment row stays ~200
bytes instead of tens of KB, and per-ride segment queries (the hot path for metric
computation) never touch the blob; (c) re-running detection with new thresholds
replaces segment rows without touching geometry. The denormalized
`startTime`/`endTime` and metric deltas are derived once from the stream at
detection time so that metric adjustment and UI display need only the segment rows.

### 2.3 `OverpassCache` — cached lift geometry per area

Follows the `WeatherCache`/`GeoCache` precedent exactly:

```prisma
model OverpassCache {
  id        String   @id @default(uuid())
  cellKey   String   @unique // bounding box rounded to a 0.05° grid cell, e.g. "45.55,-122.90"
  payload   Json     // normalized aerialway ways: [{ osmId, name, aerialwayType, points: [[lat,lng],...] }]
  isEmpty   Boolean  @default(false) // negative caching: most ride areas have no lifts
  fetchedAt DateTime @default(now())
}
```

Keyed by rounded grid cell (per the brief's constraint), not exact ride bbox, so
repeat visits to the same park are cache hits. A ride bbox maps to 1–4 cells;
query each cell, union the ways. Lifts essentially never move: treat entries as
fresh for ~180 days, refresh lazily on read past that. `isEmpty` rows make the
common case (no lifts anywhere near the ride) a single indexed read.

### 2.4 `Ride` delta columns

```prisma
model Ride {
  // ... existing fields unchanged ...
  liftDurationSeconds     Int?    // sum of segment durations; null = detection never ran
  liftElevationGainMeters Float?
  liftDistanceMeters      Float?
  liftDetectorVersion     Int?
  stream                  RideStream?
  segments                RideSegment[]
}
```

Deltas, not adjusted values: the raw provider columns (`durationSeconds`,
`elevationGainMeters`, `distanceMeters`) remain exactly what the provider sent,
forever. Effective metrics are computed as `raw − lift` in one shared helper (see
§4). `null` means "never analyzed" and is distinguishable from `0` ("analyzed,
no lift found") — this is what makes backfill progress and reversal auditable.

### 2.5 Migrations and pre-feature rides

Four additive migrations (or one combined), all safe under the boot-time
`prisma migrate deploy`: new tables plus nullable columns, no rewrites of existing
rows, no downtime. Rides imported before the feature simply have `stream = null`
and `liftDurationSeconds = null` and display raw metrics unchanged — indefinitely,
by decision (§7): there is **no bulk backfill**. A historical ride gets analyzed
only when its owner taps "Mark Bike Park Ride" (§3.4), which fetches its stream
and runs detection on demand. Because `null` still means "never analyzed," a bulk
sweep remains possible later without any schema change if the decision is
revisited. Reversal is `UPDATE "Ride" SET "liftDurationSeconds" = NULL, ...` (or
just disabling the flag, which stops the helper from subtracting) — no raw data
was touched.

---

## 3. Pipeline changes

### 3.1 Where detection runs

A new BullMQ queue + worker pair, `lift.queue.ts` / `lift.worker.ts`, modeled on
the existing weather queue (`apps/api/src/lib/queue/weather.queue.ts`,
`apps/api/src/workers/weather.worker.ts`), registered in
`src/workers/index.ts` and gated (like everything else) on `REDIS_URL`.

Every Strava ride-persist site already calls `enqueueWeatherJob` after upsert;
`enqueueLiftDetectionJob(rideId)` is added at the two **ongoing** call sites:

- `upsertStravaActivity` (`sync.worker.ts:291`)
- webhook `processActivityEvent` (`webhooks.strava.ts:190`)

The historical-import route (`strava.backfill.ts:233`) deliberately does **not**
enqueue detection: a new user connecting Strava can create hundreds of rides in
one request, and per the no-backfill decision (§7) history is not auto-analyzed —
this also protects the shared Strava rate limit. Historical rides enter the
pipeline only via "Mark Bike Park Ride" (§3.4).

Only rides with `stravaActivityId` and a start coordinate are enqueued. Manual
rides, Whoop rides (no GPS), and Garmin/Suunto rides are skipped in v1.

The job:

1. **Fetch stream** (skip if `RideStream` exists and is fresh): one call to
   `GET /api/v3/activities/{id}/streams` using `getValidStravaToken`, with an
   AbortController timeout following the Open-Meteo pattern
   (`open-meteo.ts:109`). Persist `RideStream`.
2. **Load lift lines**: compute grid cells from the stream bbox, read
   `OverpassCache`; on miss, one Overpass query with a 10 s timeout, a proper
   `User-Agent`, and a Redis-backed courtesy throttle (≤1 concurrent request
   app-wide, via the existing `acquireLock` primitives in `rate-limit.ts`).
   Cache the result, including empty results.
3. **Detect**: call the pure detector — `detectLiftSegments(points, liftLines) →
   segments[]` — adapted from the reference `liftDetection.ts` into
   `apps/api/src/lib/lift-detection/`. No I/O inside; fully fixture-testable.
4. **Persist**: in one transaction, delete prior segments for the ride
   (idempotent re-detection), insert new ones, set the `lift*` delta columns and
   `liftDetectorVersion`.
5. **Apply metric effects** only when the exclusion flag is on (§4): diff old vs
   new effective duration through the existing `syncBikeComponentHours` machinery
   and call `invalidateBikePrediction`.

### 3.2 Failure and degradation

Detection can never block or fail an import because it runs on a separate queue
after the ride is already persisted — the same isolation the weather enrichment
already has. Degradation ladder:

- **Overpass down/timeout/rate-limited:** run Layer B alone. The combined
  confidence is computed with the geometry term absent and a stricter kinematic
  threshold (Layer B alone must clear a higher bar, since it is the layer that
  confuses truck shuttles). `geometryScore = null` on the persisted segment
  records that the decision was made without geometry — auditable and re-runnable
  later. Optionally re-enqueue a low-priority re-detection with backoff so
  geometry gets applied when Overpass recovers.
- **Strava streams call fails:** BullMQ retries (attempts: 3–5, exponential —
  same posture as the sync queue). After final failure the ride simply keeps
  `liftDurationSeconds = null` and raw metrics. Nothing user-facing breaks.
- **Redis absent** (`REDIS_URL` unset, e.g. local dev): queue never starts;
  imports behave exactly as today.
- **Detector throws:** caught in the worker, reported to Sentry (matching the
  `orphaned_component_hours` pattern), ride left unanalyzed.

### 3.3 Raw stream persistence — required, and cheap

Streams must be persisted (not fetched-and-discarded) because: threshold tuning
and `detectorVersion` bumps require re-running detection without re-hitting
Strava's rate limit; the validation phase needs fixtures pulled from real rides;
and the reversibility constraint ("prefer recomputation from retained raw data")
is only satisfiable if the raw data is retained. Cost is a few GB at current
scale (§2.1). Strava's rate limit (app-wide, on the order of hundreds of requests
per 15 min / low thousands per day) comfortably covers ongoing imports (~1 extra
request per new ride); with bulk backfill dropped, the only other stream traffic
is user-triggered marks, which are throttled per user (§3.4).

### 3.4 "Mark Bike Park Ride" — user-triggered analysis of a historical ride

The only way a pre-feature ride gets analyzed. A button on a specific ride in the
web app (natural homes: `RideCard` and/or `EditRideModal`,
`apps/web/src/components/`) calls a new GraphQL mutation:

```graphql
markBikeParkRide(rideId: ID!): MarkBikeParkRideResult
```

added to the SDL in `apps/api/src/graphql/schema.ts` with its resolver in
`resolvers.ts` following the existing conventions (ownership check via context
`userId`, rate limit via `checkMutationRateLimit` with a new entry in
`MUTATION_RATE_LIMITS`, `src/lib/rate-limit.ts`). The resolver validates the ride
is the user's, is Strava-sourced with a start coordinate, and is not already
analyzed or in flight — then enqueues the same `enqueueLiftDetectionJob(rideId)`
the import path uses. The job itself (§3.1 steps 1–5) is identical; the mutation
is just a second entry point.

Throttling, per the decision (§7):

- **One in flight per user.** Deterministic job ID per ride gives per-ride dedup
  for free (BullMQ rejects duplicates, same pattern as `buildSyncJobId`); the
  resolver additionally rejects with "analysis already running" if the user has
  any pending/active lift job, so marks are strictly serial per user.
- **Rate-limited per user** via the existing Redis sliding-window limiter — a
  small budget (e.g. a handful per hour) since a legitimate user marks a few park
  days, not their whole history. Exact numbers are tuning-phase.

The mutation returns quickly (enqueued, not completed); the ride's numbers adjust
when the job lands, same as the accepted post-import shift for new rides. Scope
note: the brief ruled out user-facing UI *for reviewing or overriding segment
classification*; this button triggers analysis and does not expose or override
classification, so it is a deliberate, narrow carve-out — the silent-exclusion
posture is unchanged.

---

## 4. Metric and wear changes

### 4.1 One helper, everywhere

A single function in `apps/api/src/lib/effective-metrics.ts`:

```ts
effectiveMetrics(ride): { durationSeconds, elevationGainMeters, distanceMeters }
// = raw − lift deltas when the flag is on and deltas are non-null; raw otherwise
```

Consumed at exactly these points — this is the complete list of places a number
changes:

| Where | What changes | File |
| --- | --- | --- |
| GraphQL `Ride` field resolvers | `durationSeconds`, `elevationGainMeters`, `distanceMeters` resolve to effective values | `resolvers.ts` (add `Ride.*` field resolvers) |
| `bikeHistory` / `sharedBikeHistory` totals | replace raw `_sum` aggregates with sums of `(raw − coalesce(lift, 0))` | `resolvers.ts:~1410-1690` |
| User totals `_sum` | same | `resolvers.ts:1640` |
| Component-hour crediting | `syncBikeComponentHours` and all its call sites receive effective duration | `component-hours.ts`, worker/webhook call sites |
| Prediction engine ride window | `getAllRidesForBike` maps rides through the helper before `calculateRideWear`/`calculateTotalHours` | `services/prediction/window.ts`, `wear.ts` |
| `deleteRide` / `updateRide` hour adjustments | diffs computed on effective duration | `resolvers.ts:1786, 1829` |

Because the web app computes all dashboard stats client-side from the `RIDES`
query (`useRideStats.ts`), adjusting the `Ride` field resolvers propagates to
every web surface — and to the external mobile client — with **zero client
changes**. This is what makes silent exclusion cheap.

### 4.2 Which metrics change, and which never had lift in them

**Exclude lift entirely:**

- `durationSeconds` (Strava `moving_time` counts the chairlift as moving) →
  effective duration drops by segment duration. This is the dominant effect: it
  feeds `Component.hoursUsed`, simple-mode `hoursSinceService`, and the `wH` term
  in predictive mode — i.e. **every trackable component type equally**, because
  the stored counter does not differentiate by type.
- `elevationGainMeters` → lift ascent removed. User-facing totals change for
  everyone; wear changes **only in PRO predictive mode**, where elevation feeds
  the climbing (`wC`) and steepness (`wV`) weights — brakes
  (`BRAKE_PAD`/`BRAKE_ROTOR`/`BRAKES`), tires, and pivot bearings most;
  `REAR_DERAILLEUR` (wC=0, wV=0) not at all.
- `distanceMeters` → lift travel distance removed (small; lifts are short
  horizontal distances). Affects totals and the predictive `wD`/`wV` terms.

**Never had lift in them (no change):**

- `averageHr` — provider-computed over the whole activity. Recomputing it from
  the HR stream excluding lift windows is possible once streams exist, but it
  feeds nothing in the wear model; out of scope for v1 (open question §7).
- Weather enrichment, location/trailSystem geocoding — keyed off start point and
  time only.
- `weatherBreakdown` — counts conditions, not metrics.
- Descent-phase load on brakes, suspension, and tires — the lift segment is by
  definition not a descent, and the current model has no explicit descent term
  anyway; the descent's duration, distance, and (zero) elevation gain are outside
  the excluded windows and unchanged.

**Directionally-correct-but-imperfect (accepted for v1):** drivetrain wear should
ideally key off active pedaling time (cadence > 0), not merely non-lift moving
time. Cadence is in the persisted stream, so this refinement is available later
without re-fetching; v1 stops at lift exclusion. Noted in §7.

### 4.3 Consistency rules for retroactive changes

Whenever the deltas on an already-counted ride change (first detection,
re-detection, a user marking a historical ride), the worker must, in order:
compute the hour diff (old effective vs new effective duration) through the same
diff logic `updateRide` uses; apply it via `syncBikeComponentHours`; and call
`invalidateBikePrediction(userId, bikeId)`. With bulk backfill dropped,
retroactive changes arrive one ride at a time, so incremental diffing is
acceptable — the floor-at-0 drift risk in `decrementBikeComponentHours`
(`component-hours.ts:37`) is bounded by the per-user mark throttle. If a bulk
sweep is ever revived, switch to per-component **recompute** (the
`recomputeComponentAfterServiceChange` aggregate pattern, `resolvers.ts:306`)
instead of accumulated decrements. `ServiceLog.hoursAtService` snapshots are
historical facts recorded at service time and are deliberately **not** rewritten.

---

## 5. Phasing

Each increment ships and reverts independently. The brief's suggested shape holds
with two deviations: an added prerequisite increment (forced by Finding 1), and
the historical backfill replaced by user-triggered per-ride analysis (decision,
§7).

1. **Stream ingestion (prerequisite).** `RideStream` model + migration; stream
   fetch added to the lift worker's step 1 only (no detection yet); enqueue on new
   Strava imports. Independently valuable: unlocks any future per-point feature
   (maps, descent metrics). Revert: stop enqueueing; drop table later.
2. **Shadow-mode detection.** `RideSegment` + `OverpassCache` models; the pure
   detector adapted from `liftDetection.ts` with fixture tests; the full worker
   pipeline persisting segments and delta columns — but no consumer reads the
   deltas. Zero user-visible change by construction. Revert: stop the worker.
3. **Validation pass.** An admin-only report (script or admin route following
   `src/routes/admin.ts` conventions) listing, per analyzed ride: detected segment
   count, lift names, confidence scores, per-segment deltas. Run against known
   park rides (§6). No schema or user-facing change. Revert: n/a (read-only).
4. **Threshold tuning.** Adjust detector constants against the validation set;
   bump `detectorVersion`; re-enqueue analyzed rides (streams already persisted, so
   no Strava calls). Repeat 3–4 until the acceptance bar (§6) is met. Revert: n/a.
5. **Metric exclusion behind a flag.** `LIFT_METRIC_EXCLUSION_ENABLED` env var —
   the repo's established gating convention (`GARMIN_VERIFICATION_MODE`; no flag
   framework exists). Lands the `effectiveMetrics` helper at the §4.1 call sites
   and the hour-diff/cache-invalidation logic. Applies to newly-detected rides
   only at this point. Revert: unset the env var — every number returns to raw
   instantly because raw columns were never touched.
6. **"Mark Bike Park Ride" (replaces bulk backfill).** The `markBikeParkRide`
   mutation, per-user throttling, and the web button (§3.4). Historical rides are
   analyzed only on explicit user request, one at a time. During increments 2–4
   the mutation can ship early in admin-only form (or as a dev script hitting the
   same enqueue) to seed validation fixtures from known park rides. Revert:
   remove the button/mutation; already-marked rides revert with the flag like any
   other. A bulk sweep stays possible later with no schema change, since
   unanalyzed rides remain distinguishable (`liftDurationSeconds IS NULL`).

---

## 6. Validation plan

**Ground truth.** The practical ground-truth set is rides by the maintainer and
friendly users at known lift-served parks — as the brief notes, **lap count is the
check**: a rider knows they did N lifts that day, and the detector must find N
lift segments. With bulk backfill dropped, the validation set accrues two ways:
new rides flowing through shadow mode (it is July — peak park season, so park
rides arrive quickly), and hand-picked historical park rides analyzed via the
mark-ride enqueue path (§3.4, admin/dev form) — a handful of Strava calls, not a
sweep. Because streams are persisted, any analyzed ride can be
exported as a JSON fixture into
`apps/api/src/lib/lift-detection/__fixtures__/` (the repo currently has zero ride
fixtures — these will be the first) and asserted against in ordinary Jest tests
with no network, satisfying the pure-function constraint.

**Fixture matrix** (minimum set before increment 5 ships):

| Case | Expectation |
| --- | --- |
| Park day with chairlift, N known laps, park mapped in OSM | exactly N LIFT segments, geometry + kinematic both scoring |
| Park day at a park with poor/absent OSM `aerialway` coverage | N segments from Layer B alone (this is the stricter-threshold path) |
| Gondola (enclosed, possibly indoor GPS dropout) | segments still detected; graceful handling of gaps |
| Ordinary trail ride, no lift | 0 segments |
| Sustained fire-road or paved climb (steady VAM, straight) | 0 segments — the known Layer B confusion case |
| Truck-shuttle day | explicitly documented outcome; false LIFT positives here are acceptable only if flagged, since shuttle detection is out of scope |

**Acceptance bar to enable increment 5:**

- Lap count exactly matches rider-reported reality on 100% of geometry-covered
  park fixtures, and ≥90% on kinematic-only fixtures.
- Zero false-positive segments across a random sample of ≥50 non-park rides from
  the existing production ride table (run in shadow mode, so this costs nothing).
- Excluded elevation per park day is sanity-checked against `N × known lift
  vertical` within ~15%.

Shadow mode (increment 2) makes this free: the detector runs on all real incoming
rides for weeks while affecting nothing, and the increment 3 report is reviewed
before any number changes.

---

## 7. Risks and open questions

**Risks:**

1. **Strava rate limit is app-wide and shared.** Stream fetches (+1 request per
   import, plus user-triggered marks) draw from the same budget as live sync and
   webhook processing. Dropping bulk backfill removed the worst pressure;
   remaining mitigation is the per-user mark throttle (§3.4) and monitoring 429s.
   Current limits should still be confirmed in the Strava dashboard before
   increment 1.
2. **Strava API agreement on stored data.** Storing streams of a user's own
   activities is permitted, but data must be deleted on disconnect/deauthorization.
   `RideStream` cascades from `Ride`; the existing deauth webhook
   (`webhooks.strava.ts:124`) must be checked for whether it deletes rides or only
   tokens — if rides survive disconnect today, streams will too, and that needs a
   decision.
3. **Summary/stream inconsistency.** `moving_time` is Strava's own computation;
   our lift window duration is stream-derived. Subtracting one from the other can
   over- or under-correct when Strava already discounted part of the lift as
   "stopped" (slow chairs sometimes trip Strava's moving detection). The `moving`
   stream is requested precisely so the delta can count only points Strava
   considered moving. This is a tuning-phase concern; the validation elevation
   check (§6) catches gross errors.
4. **Incremental hour-adjustment drift.** Floor-at-0 decrements
   (`component-hours.ts:37`) plus the pre-existing orphaned-hours gap
   (`sync.worker.ts:647`) mean repeated retroactive diffs can drift. With no bulk
   backfill, retroactive diffs are rare and throttled (§4.3), so the exposure is
   small; a general "rebuild hours from ride log" admin command would be a
   worthwhile side quest but is not required.
5. **Overpass etiquette.** Single community endpoint, aggressive caching with
   negative caching, one concurrent request, proper User-Agent. Worst case
   (Overpass long-term unavailable) the system runs kinematic-only permanently —
   degraded precision, not failure.

**Decisions (resolved 2026-07-18):**

1. **Post-import metric shift — accepted.** Detection is async, so a park ride's
   numbers appear raw for seconds-to-minutes after import, then silently drop
   when the worker finishes. Accepted as-is; delaying import visibility would
   violate the never-block rule in spirit.
2. **`averageHr` — leave raw.** The provider's whole-activity average stays;
   recomputing from the HR stream excluding lift windows changes a displayed
   number for no wear effect. Revisit only if users notice.
3. **Drivetrain pedaling-time refinement — fast-follow.** Cadence-keyed
   drivetrain wear ships as its own follow-up after metric exclusion is live,
   with its own validation. Cadence is already in the persisted stream, so no
   re-fetch is needed.
4. **Strava disconnect — keep rides, delete streams.** On
   deauthorization/disconnect, users keep ride history and component hours; raw
   `RideStream` blobs (the bulky, ToS-sensitive part) are deleted. Already-applied
   segments and delta columns stay. Implementation note: this means `RideStream`
   deletion must be wired into the deauth webhook
   (`webhooks.strava.ts:124`) and the disconnect path explicitly — cascade from
   `Ride` alone does not cover it, since rides survive. Current deauth behavior
   for rides still needs confirming during increment 1.
5. **No bulk historical backfill.** Lift exclusion applies to rides imported
   after the feature ships. Rationale: removes retroactive mass-mutation risk on
   a live database, the hour-recompute machinery, and the rate-limit sweep; wear
   due-status is anchored at last service (`hoursSinceService`), so pre-feature
   inflation washes out of predictions within one service cycle per component.
   Lifetime totals will mix unadjusted old park rides with adjusted new ones —
   accepted as cosmetic at current scale. Consistent with this, the new-user
   history import (`strava.backfill.ts`) does not enqueue stream fetches at all.
   Nothing forecloses a later sweep: unanalyzed rides keep
   `liftDurationSeconds = NULL`.
6. **"Mark Bike Park Ride" button (user-triggered analysis).** The one path for
   historical rides: a per-ride button in the web app backed by the
   `markBikeParkRide` mutation (§3.4), enqueueing a single detection job —
   strictly one in flight per user, plus a per-user rate limit. A deliberate,
   narrow exception to the no-user-facing-UI scope line: it triggers analysis
   but does not expose or override classification.

**Decided constraints, re-checked against the audit — all hold:**

- *Strava first*: confirmed practical; Garmin has no equivalent stream fetch in
  the current code, and its `activityDetails` webhook payload (which can carry
  samples) is a natural later entry point. Source-specific code confined to
  stream normalization (`RideStream.source` + per-source fetcher).
- *Both layers, one score*: no audit conflict; the degradation ladder (§3.2)
  keeps the combined-score design while surviving Overpass outages.
- *Silent exclusion*: cheap here because all clients read the same GraphQL ride
  fields (§4.1); segments + confidence persisted for auditability.
- *Raw streams never mutated*: enforced structurally — detection writes only
  `RideSegment` rows and `Ride.lift*` delta columns.
