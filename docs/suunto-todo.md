# Suunto integration — remaining work

Gap inventory vs the Garmin integration, produced after the initial OAuth + webhook + Settings UI landed. Ordered by user-visible impact.

## 1. Sync worker handlers — ✅ done

Implemented `syncSuuntoLatest()`, `syncSuuntoActivity()`, and `upsertSuuntoActivity()` in [sync.worker.ts](../apps/api/src/workers/sync.worker.ts). The two switch statements (`syncLatestActivities` + `syncSingleActivity`) now route Suunto jobs to real handlers instead of warning.

Details:
- List sync: `GET /v3/workouts?since=&until=&limit=&offset=` paginated 30-day window, cycling filter via `isSuuntoCyclingActivity`.
- Single sync: direct `GET /v3/workouts/{workoutKey}`, unwraps the `{ error, metadata, payload }` envelope defensively.
- Upsert: auto-assigns the user's only active bike on new rides (preserved on re-sync), Garmin-style two-transaction safety so a component-hour failure never drops the ride, fires weather + notifications + referral completion.
- All data-API calls send `Ocp-Apim-Subscription-Key` via a shared `suuntoApiHeaders()` helper.

---

## 2. Backfill batch queue — ✅ done

Added `POST /suunto/backfill/batch` that enqueues one job per year via the shared backfill queue, mirroring the Garmin flow.

Changes:
- New shared helper module [lib/suunto-sync.ts](../apps/api/src/lib/suunto-sync.ts) holds the API base URL, `SuuntoWorkout` / `SuuntoWorkoutsResponse` types, and the `suuntoApiHeaders()` builder so all three call sites (sync worker, backfill worker, synchronous backfill route) agree.
- Extended `BackfillProvider` to `'garmin' | 'suunto'` in [backfill.queue.ts](../apps/api/src/lib/queue/backfill.queue.ts).
- [backfill.worker.ts](../apps/api/src/workers/backfill.worker.ts) now dispatches on provider and ships a `processSuuntoBackfill(userId, year)` that paginates `/v3/workouts`, filters cycling, runs cross-provider dedup via `findPotentialDuplicates`, auto-assigns the single active bike, tracks component hours, enqueues weather jobs, and updates `BackfillRequest` status.
- [suunto.backfill.ts](../apps/api/src/routes/suunto.backfill.ts) now has two endpoints: the original synchronous `/fetch` (kept for single-year immediate-feedback flows) and the new `/batch` (queued, matches Garmin).
- Fixed the **subscription-key bug** while here — the synchronous `/fetch` now uses `suuntoApiHeaders()` so every data-API call sends `Ocp-Apim-Subscription-Key`.

---

## 3. Component hour tracking in webhook — ✅ done

Extracted the inline `syncBikeComponentHours` helper (duplicated between [webhooks.strava.ts](../apps/api/src/routes/webhooks.strava.ts) and [workers/sync.worker.ts](../apps/api/src/workers/sync.worker.ts)) into [lib/component-hours.ts](../apps/api/src/lib/component-hours.ts), then wired it into every ingestion path that was missing it.

Changes:
- **New shared helper**: `syncBikeComponentHours(tx, userId, previous, next)` exported from `lib/component-hours.ts`. Handles bike changes + duration diffs with floor-at-zero decrement semantics.
- **Suunto webhook** ([webhooks.suunto.ts](../apps/api/src/routes/webhooks.suunto.ts)): now reads the existing ride before upsert, auto-assigns the single active bike on new rides (matching sync worker + backfill behavior), wraps upsert + hour sync in one transaction so a failure rolls both back.
- **Garmin backfill callback** ([backfill.worker.ts](../apps/api/src/workers/backfill.worker.ts) `processGarminCallback`): was the actual Garmin gap — the webhook just enqueues to sync worker (which already synced hours), but the callback-delivered backfill rides silently skipped hour tracking. Now reads existing bikeId + duration and wraps upsert in a transaction with the helper.
- **Dedup cleanup**: removed the two inline copies of the helper from `webhooks.strava.ts` and `sync.worker.ts` now that they import from the shared lib.

**Note on Garmin webhook**: the Explore agent's earlier report flagged it as missing hour tracking, but actually the webhook only enqueues a sync job — the sync worker's `upsertGarminActivity` already calls `syncBikeComponentHours`. The real gap was the backfill callback, now fixed.

---

## 4. Bike/gear auto-mapping — moderate (optional)

**Problem**
Suunto webhook payload includes `gear: { manufacturer, name, productType }` but [webhooks.suunto.ts](../apps/api/src/routes/webhooks.suunto.ts) ignores it. Strava has a `StravaGearMapping` table + overlay UI; Garmin has nothing.

**Consequence**
Riders with multiple bikes must manually assign every Suunto workout to the right bike, even though Suunto is telling us which watch uploaded it (not a bike, but could be a useful correlation).

*Note*: Suunto's `gear` field is the **watch** (e.g., "Suunto Vertical"), not the bike. So this isn't a direct bike-mapping opportunity the way Strava's gear_id is. Probably not worth building.

**Approach**
Skip unless the gear field turns out to be rider-configurable for bikes.

---

## 5. Mock endpoint for dev testing — tiny

**Problem**
[mock.garmin.ts](../apps/api/src/routes/mock.garmin.ts) exists for admin/dev fixtures. No Suunto equivalent.

**Approach**
Copy the pattern if we want repeatable local testing without hitting Suunto's API.

---

## 6. Activation email — ✅ done

Added a Suunto-integration-live broadcast email matching the existing Strava pattern (admin-sendable via the email UI, not auto-fired on connect).

Changes:
- New template [apps/api/src/templates/emails/suunto-enabled.tsx](../apps/api/src/templates/emails/suunto-enabled.tsx) — mirrors the Strava version with Suunto-specific copy: direct watch sync (no Strava middleman), auto-bike-assign behavior, backfill pointer, duplicate-detection note for multi-provider users.
- `EmailType` enum in [schema.prisma](../apps/api/prisma/schema.prisma) extended with `suunto_integration_live`. Requires a migration (`npm run prisma:mig add_suunto_integration_live_email_type`).
- Registered in [templates/emails/index.ts](../apps/api/src/templates/emails/index.ts) so it appears in the admin email UI.

**Reused the existing infrastructure** — same tokens/dark-mode/layout primitives as strava-enabled.tsx. Swap the hero image if you want something more Suunto-specific; `RyanAbenaki.jpg` is fine as a placeholder.

---

## Bugs fixed in passing

- ✅ **Backfill missing subscription key**: fixed as part of #2 — all Suunto data-API calls now flow through the shared `suuntoApiHeaders()` helper.

## Known non-gaps (for the record)

- **`isActiveSource` in webhook**: Suunto webhook checks it, Garmin doesn't — *Suunto is ahead here*.
- **Dedup in webhook path**: neither Garmin, Strava, nor Suunto dedup in the webhook path (only in backfill). By design.
- **GraphQL resolvers**: provider-agnostic already; no Suunto-specific resolvers needed.
