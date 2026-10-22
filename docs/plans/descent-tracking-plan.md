# Descent Tracking: Scoping Plan

Status: Phase 1 shipped to staging in PR #381 (2026-10-21): the column, provider
ingest, lift-worker fill, GraphQL field and ride-level display on web, with the
mobile companion in loam-logger-mobile#117. Phases 2 (recorder), 3 (totals and
stats) and 4 (brake wear) remain proposals. Scoped from a codebase audit on
2026-10-21. Companion to `lift-detection-plan.md`, which this builds on.

A note on clearing: `updateRide` with `elevationLossMeters: null` resets the
column to "not reported", but nothing pins it there. A provider re-sync writes
the provider's figure again and a later lift analysis fills it from the stream,
the same way a re-sync re-writes gain. That is intended: descent is measured
data, and a rider who wants a different number enters one rather than blanking it.

## 1. Why

Garmin (and Suunto, WHOOP, and any altitude stream) reports descent as well as
ascent. Loam stores only `Ride.elevationGainMeters`, so a rider reads one number
and assumes the other matches. That assumption breaks exactly where the product
cares most:

- **Shuttle days.** The rider pauses the watch in the truck, or records the
  shuttle as its own activity. Gain is near zero; descent is thousands of feet.
  Today those rides look like flat spins.
- **Bike park days.** Lift detection already subtracts lift gain from the
  displayed total, so a park day shows little climbing. What was actually ridden
  is the descent, and nothing records it.
- **Brake wear.** The prediction engine has no descent input. Brake pads and
  rotors are weighted on *climbing* (`wC` 1.2) and steepness (`wV`) as a stand-in,
  and `explain.ts:80` literally says "More descending lately has increased brake
  wear" when the top driver is the climbing factor. On a shuttle day the proxy
  collapses to zero and brake wear is under-counted.

Descent is also the number a park rider wants to see ("12,000 ft of descending
today"), so it earns a place in the ride detail and the stats cards regardless of
the wear model.

## 2. Where descent comes from, per source

| Source | Summary field | Status in code today | Fallback |
|---|---|---|---|
| Garmin Activity API | `totalElevationLossInMeters` (sibling of `totalElevationGainInMeters`) | Dropped: not in `GARMIN_ACTIVITY_FIELDS` (`apps/api/src/types/garmin.ts:117`), so `pickGarminActivityFields` strips it before the worker sees it | Activity Details `samples[].elevationInMeters` already become a `RideStream.altitude` series (`lib/garmin-streams.ts`) |
| Suunto | `totalDescent` | Already typed in `lib/suunto-sync.ts:23` and `routes/webhooks.suunto.ts:47`, never written | None (no streams) |
| WHOOP | `score.altitude_gain_meter` and `score.altitude_change_meter` (net) | Both typed in `types/whoop.ts:38`; only gain is read | loss = gain minus change when both present, else null |
| Strava | none. `SummaryActivity` and `DetailedActivity` have `total_elevation_gain`, `elev_high`, `elev_low` only | n/a | `altitude` stream is already fetched (`lib/strava-streams.ts:9`); derive |
| In-app recording (mobile) | none today | The accumulator in `src/lib/recording/geo.ts:147` moves the anchor down for free; the downward move is measured but not booked | The uploaded `RideTrackInput.altitude` series lets the server derive it too |
| Manual entry (web form, mobile add) | none | n/a | Optional input, else null |

**Server-side derivation already exists and is unused.** `computeAdjustedMetrics`
in `lib/lift-detection/detector.ts:497` walks the stream and returns
`elevationLossMeters` alongside gain. It is exported from the lift-detection
index and consumed by nothing but its test. The lift worker runs for every ride
that gets an altitude stream (Strava, Garmin details, in-app tracks), so the
hook point for "derive descent when the provider did not say" is one call in
`workers/lift.worker.ts` next to the `ride.update` at line 143.

## 3. Semantics to decide up front

1. **Nullable, not zero.** `elevationLossMeters Float?`. NULL means "no source
   gave us one" (pre-feature rides, manual rides, Strava rides without a
   stream, WHOOP without `altitude_change_meter`). Zero means a real flat ride.
   Clients hide the stat on NULL rather than rendering 0 ft, which would be a
   lie on every historical ride. Same convention as `liftDetectorVersion`.
2. **Provider value wins, stream value fills gaps.** Garmin and Suunto run their
   own barometric smoothing and their descent is the number the rider sees in
   Connect. Only write the stream-derived figure when the column is NULL, so a
   re-run of lift detection never overwrites a provider number with a noisier
   one. This mirrors how `elevationGainMeters` is never adjusted in place.
   Debugging note: the two sources legitimately disagree, often by 5 to 15
   percent on the same ride. The provider applies its own barometric
   smoothing before summing; the stream sum in `computeAdjustedMetrics` is a
   plain signed walk over the altitude series with no deadband. A ride whose
   gain came from Garmin and whose loss came from the stream (possible only
   when Garmin omitted the loss) can therefore show a gain/loss gap that is
   not real terrain. Compare the ride's `garminActivityId`/`suuntoWorkoutId`
   against whether `RideStream` exists before reading anything into it.
3. **Raw, like everything else.** The schema comment on `ComponentUsageTotals`
   is explicit that every consumer reads raw columns. Descent is unaffected by
   lifts anyway (the detector notes this), so there is no lift delta column to
   add.
4. **Not a duplicate-detection input.** `lib/duplicate-detector.ts` matches on
   date, distance and gain. Adding loss would only create false negatives
   between a provider that reports it and one that does not.
5. **Garmin attribution is unchanged.** Rides already render "Garmin [device]"
   wherever Garmin data appears. A new Garmin-sourced number adds no new
   obligation, but it must not appear on a surface that lacks the attribution.

## 4. Work breakdown

### Phase 1: store it, ingest it, show it on the ride (api + both clients)

**Migration** (PR into `staging` first, then promote, per CLAUDE.md):
- `Ride.elevationLossMeters Float?`. No data backfill in the migration.

**Provider ingest** (every site that writes `elevationGainMeters`; there are 21
across 7 files, plus `addRide`/`updateRide`):
- Garmin: add `totalElevationLossInMeters` to `GARMIN_ACTIVITY_FIELDS` and the
  `GarminActivity` types in `workers/sync.worker.ts:97` and
  `workers/backfill.worker.ts:89`; map it in `upsertGarminActivity`
  (`sync.worker.ts:821`) and the backfill equivalent (`backfill.worker.ts:883`).
  `types/garmin.test.ts` asserts the projection key by key, so it needs the new
  key. Use `?? null`, never `?? 0`.
- Suunto: map `workout.totalDescent ?? null` in `routes/webhooks.suunto.ts:171`,
  `routes/suunto.backfill.ts:296`, `workers/sync.worker.ts:1300`,
  `workers/backfill.worker.ts:628`.
- WHOOP: gain minus change when both are finite, else null, in
  `routes/whoop.backfill.ts:213` and `workers/sync.worker.ts:1081`. WHOOP's
  altitude is phone-derived and coarse; clamp at zero and prefer null to a
  negative.
- Strava: write null at the four upsert sites; the stream path fills it.
- Lift worker: call `computeAdjustedMetrics(points, detected)` (it already has
  both inputs) and include `elevationLossMeters` in the `ride.update` only when
  the current value is NULL. Either select the current value first or use a
  conditional `updateMany` with `elevationLossMeters: null` in the `where`.
- In-app rides: nothing extra on the server; the track reaches the same lift
  job via `persistRecordedTrack` (`resolvers.ts:333`).

**GraphQL**:
- `Ride.elevationLossMeters: Float` with a docstring stating the NULL rule.
- `AddRideInput.elevationLossMeters: Float` and `UpdateRideInput.elevationLossMeters: Float`
  (optional; clamp to >= 0 like gain at `resolvers.ts:2415` and `:2774`).
- Add the field to the shared fragments in `libs/graphql/src/operations/`
  (`rides`, `addRide`, `updateRide`) and the mobile copies under
  `loam-logger-mobile/src/graphql/operations/` (`ride`, `rides`, `ridesPage`,
  `addRide`, `updateRide`, `componentRides`, `bikeHistory`, `componentHistory`).
- Run codegen in both repos with the API up and commit the generated files
  (`libs/graphql/src/generated/`, mobile `src/graphql/generated.ts`).
- `libs/shared/src/types/ride.ts` and `apps/web/src/models/Ride.ts` get the
  optional field.

**Display, ride level only**:
- Web: `RideCard.tsx:111` meta row, `dashboard/CompactRideRow.tsx:40`,
  `history/HistoryRideList.tsx:68`, `EditRideModal.tsx` (optional "Descent"
  input beside "Elevation Gain"), `AddRideForm.tsx` (optional input).
  `lib/format.ts` `fmtElevation` already does the unit conversion.
- Mobile: `app/ride/[id].tsx:476` stats grid gains a `trending-down-outline`
  item when non-null (the grid already flexes for the optional HR item),
  `src/components/rides/RideListItem.tsx:83`, `app/ride/edit/[id].tsx` and
  `app/ride/add.tsx` optional inputs. The share overlay at `[id].tsx:539` is a
  product call; see the open questions.
- Copy: pair the labels as "Climb" and "Descent" everywhere; the dashboard
  compact card already says "Climb". Never "Elevation" alone once two numbers
  are on screen.

**Tests**: provider mapping tests (`backfill.worker.test.ts`,
`whoop.backfill.test.ts`, `suunto.backfill.test.ts`, `garmin.test.ts`), lift
worker null-fill test, `addRide`/`updateRide` resolver tests, web RTL tests for
the ride card and edit modal, mobile `RecentRidesList.test.tsx`.

Rough size: 2 to 3 days including the staging promotion cycle.

### Phase 2: in-app recorder books descent

- `geo.ts` accumulator: add `elevationLossM`; in the branch where
  `altitudeAnchor - value >= hysteresisM`, book `altitudeAnchor - value` before
  moving the anchor. The symmetric deadband already exists, so the one-sided
  ratchet the comments warn about does not come back. `recorder.ts` persists
  `elevation_gain_m` in the `recording_session` SQLite table (`:289`, `:589`);
  add `elevation_loss_m` with a local migration, thread it through the summary
  (`:693`) and `save-recording.tsx:85`.
- The barometer airflow note in `altitude.ts:43` cuts both ways: airflow lowers
  the sensed pressure on a descent, so a descending rider can read as slightly
  higher than the terrain. Expect the recorder's descent to be a little low,
  not high. Add a test in `altitude.test.ts` mirroring "a descent books no
  climb" with "a climb books no descent".
- Server already derives descent from the uploaded track in Phase 1, so this
  phase only improves the pre-save summary screen and offline-queued rides. It
  can ship in any mobile release after Phase 1's API is live.

Rough size: 1 day plus a mobile release.

### Phase 3: totals and stats

- `BikeHistoryTotals.totalElevationLossMeters`, `ComponentUsageTotals.elevationLossMeters`,
  `ComponentCumulativePoint.cumulativeElevationLossMeters`. Resolver sums at
  `resolvers.ts:2159` and `:2288`, `lib/component-history.ts`,
  `lib/component-share.ts`. Sums over NULL are the sum of the known values;
  expose a `ridesWithDescent: Int` alongside so a client can say "across N of M
  rides" instead of presenting a partial total as complete.
- Web: `RideStatsCard/StatsSummary.tsx` ("Climbed" gets a "Descended" sibling),
  `RideStatsCompact.tsx` (3 metrics today; a fourth needs a layout check on the
  dashboard grid), `useRideStats.ts` (a `most_descent` record next to
  `most_elevation`), `history/BikeHistoryPdf.tsx:102`, `ComponentHistory.tsx`,
  the shared history pages.
- Mobile: `src/hooks/useRideStats.ts`, `src/lib/bikeHistory.ts`,
  `src/lib/bikeHistoryPdf.ts`, `app/bike/history/[id].tsx`, `app/component/[id].tsx`.
- Charts follow the DESIGN.md rule: descent is not component health, so it
  never borrows the health ramp.

Rough size: 1 to 2 days.

### Phase 4: brake wear uses real descent

- `services/prediction/types.ts`: extend `WearFactor` with `'descending'` and
  `ComponentWeights` with `wL`. `config.ts:92`: give `BRAKE_PAD`, `BRAKE_ROTOR`
  and `BRAKES` a `wL` and reduce their `wC` so the total wear budget for a
  typical pedal ride stays roughly where it is. Drivetrain weights get `wL: 0`.
- `wear.ts`: add the `wL * (L / 3000)` term; when `elevationLossMeters` is NULL,
  substitute gain (today's behaviour) so historical rides do not suddenly stop
  wearing brakes. `window.ts` selects at `:38`, `:72`, `:170` and
  `engine.ts:666` need the column.
- `explain.ts:80`: the "More descending lately" sentence moves to the new factor
  and the climbing factor gets honest copy.
- `wear.test.ts:262` asserts "> 50% from descent factors" against climbing and
  steepness; it needs rewriting for the new factor.
- No backfill: the engine recomputes from `Ride` rows. Invalidate the prediction
  cache (`invalidateBikePrediction`) on deploy or let the 30 minute TTL expire.
- Ship behind the existing PRO predictive-mode gate, and compare predictions on
  the internal cohort before and after (PostHog usage dashboard) since this
  shifts brake due dates for every park rider.

Rough size: 2 days, plus evaluation time.

## 5. Historical coverage and backfill

- **Rides with a stored stream** (Strava and Garmin rides synced since lift
  detection shipped, all in-app recordings): `POST /api/admin/lift/backfill-descent`
  enqueues lift jobs for every ride with a stream, coordinates and a NULL
  descent, in batches of up to 1000 newest-first, and reports how many it
  cannot fill. Send `{ "dryRun": true }` for the counts alone. The response
  carries `nextCursor`, the oldest start time and ride id in the batch; pass
  them back as `before` and `beforeId` and repeat until it is null. Rides
  whose enqueue failed come back in `failedRideIds`; the cursor walks past
  them, so enqueue those again by hand. It is a cursor rather than a
  "re-query until empty" loop because a ride can be analyzed and still have no
  descent (a track too short to sum), and would otherwise top every batch.
  Lift jobs run two at a time, so let the queue drain between batches
  rather than racing the 60 second cooldown.
- **Garmin rides without a stream**: Garmin's partner rules forbid unprompted
  pulls (`lib/garmin-activity-details.ts` explains why), so these can only be
  filled by a user-initiated backfill window, which re-delivers summaries with
  the loss field once the projection accepts it.
- **Strava rides without a stream**: the lift plan deliberately does not bulk
  fetch streams for history (section 7 of that plan). These stay NULL unless
  the rider marks the ride. Showing "no descent data" honestly is the product
  answer.
- **Suunto and WHOOP history**: a re-sync or backfill run fills them.

## 6. Open questions for the product owner

1. Should descent appear on the share overlay (mobile `[id].tsx:539`)? It is
   the single best number for a park day screenshot, but it will be missing on
   most historical rides at launch.
2. Do manual rides get a descent input at all, or does the form stay minimal
   and descent remain a synced-only stat? The forms today default gain to
   500 ft; a second default would be invented data.
3. Phase 4 changes brake due dates. Is that a silent model improvement or a
   release-note item for Pro riders? The CHANGELOG convention suggests the
   latter.
