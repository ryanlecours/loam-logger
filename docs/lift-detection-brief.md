# Loam Logger: Chairlift Segment Detection Integration Brief

## Your task

This is a two phase task. **Phase 1 is an audit. Phase 2 is a plan. Do not write
implementation code in either phase.**

Read the codebase first and ground every statement you make in real file paths and
symbol names. If you cannot find something, say so explicitly rather than assuming
it exists. When you are done with Phase 1, write the Phase 2 deliverable to
`docs/plans/lift-detection-plan.md`.

---

## Feature summary

Loam Logger imports rides from Strava and Garmin and uses them to track wear on
mountain bike components. Rides taken at lift served bike parks currently
overstate effort: the chairlift ascent is recorded as climbing, which inflates
elevation gain, moving time, and any component wear model keyed off those numbers.

The goal is to detect chairlift and gondola segments inside an imported ride and
exclude them from ride metrics and wear accrual.

Detection uses two layers combined into a single confidence score:

- **Layer A, geometry match.** Query OpenStreetMap via Overpass for
  `aerialway` ways inside the ride bounding box, buffer each line by roughly 40m,
  and check what fraction of points fall inside. High precision, patchy coverage
  at smaller parks. Also serves as bike park detection.
- **Layer B, kinematic classifier.** Score sliding time windows on sustained VAM,
  path straightness, speed variance, monotonic ascent, and cadence absence. Full
  coverage, but occasionally confuses a truck shuttle lap.

A reference implementation of both layers is provided separately as
`liftDetection.ts`. Treat it as a starting point to be adapted, not as
finished code. Its numeric thresholds are estimates that have not been validated
against real ride data.

---

## Phase 1: Codebase audit

Answer each of the following with concrete file paths. Keep it terse. This is
reconnaissance, not prose.

### Import pipeline

1. Where does Strava activity import happen? Trace the full path from OAuth token
   through to a persisted ride.
2. Do we currently fetch the Strava streams endpoint, or only the activity
   summary? If streams are fetched, which stream keys do we request, and are the
   raw streams persisted or discarded after processing?
3. Is import synchronous within a request, or queued or backgrounded? What is the
   retry and idempotency story if a ride is reimported?
4. How does the Garmin path differ? Note this for later even though Strava is the
   first target.
5. Is there a webhook or polling mechanism for new activities, and where does it
   land?

### Data model

6. Show the current Prisma models for rides, activities, and anything holding
   per point or per stream data.
7. Where are ride level aggregate metrics stored: elevation gain, distance,
   moving time, and anything else? Are they computed on read or written at
   import time?
8. Is PostGIS enabled on the database? If not, what would enabling it involve
   given the current migration setup and hosting?
9. Is there any existing concept of a segment, lap, or sub interval within a ride?

### Metrics and wear

10. Find the component wear model. Which ride metrics feed it, and per component
    type if the model differentiates.
11. Which of those inputs would change if lift segments were excluded? Be
    specific about which component types are affected and which are not.
12. Is wear computed incrementally per ride, or recomputed from the full ride
    history? This determines whether a backfill is feasible.
13. Are there any cached, denormalized, or materialized aggregates that would go
    stale if ride metrics changed retroactively?

### Surfaces

14. Where do ride metrics surface in the React web app and the React Native app?
    List the components and the GraphQL queries behind them.
15. Where is the GraphQL schema defined, and what is the convention for adding
    fields and types?
16. Is there any existing map rendering of a ride track that could show segment
    overlays? Note the OpenLayers setup if relevant.

### Infrastructure

17. How is outbound HTTP to third party APIs handled? Is there a shared client
    with retry, timeout, and rate limit handling that an Overpass call should use?
18. What caching primitives are available for storing Overpass results across
    imports?
19. What is the test setup, and are there any existing fixtures of real ride
    data that could serve as detection test cases?

---

## Phase 2: Deliverable

Write `docs/plans/lift-detection-plan.md` containing the following sections.

### 1. Audit summary

The Phase 1 findings, condensed. Lead with anything that materially changes the
shape of the work, for example missing stream data, absence of PostGIS, or a wear
model that cannot be recomputed.

### 2. Proposed data model changes

Prisma schema additions and the migrations required. At minimum a segment record
carrying ride reference, type, start and end indices into the stream, confidence
score, and matched lift name. Justify storing indices versus duplicated geometry.
Address what happens to rides imported before this feature existed.

### 3. Pipeline changes

Where detection runs in the import flow, what happens when Overpass is
unavailable or times out, and how detection failure degrades. Detection must never
block or fail an import. State whether raw streams need to be persisted and what
that costs in storage.

### 4. Metric and wear changes

Exactly which computed values change and where. Make the distinction explicit
between metrics that should exclude lift time entirely and metrics where lift
time was never a factor. Note that descent load on brakes, suspension, and tires
is unaffected, while drivetrain wear should key off active pedaling time.

### 5. Phasing

Break the work into shippable increments, each independently valuable and
independently revertible. Suggested shape, adjust if the audit argues otherwise:

- Detection running in shadow mode, persisting segments but changing no
  user visible number
- A validation pass over known park rides
- Threshold tuning based on that validation
- Metric exclusion switched on behind a flag
- Backfill of historical rides

### 6. Validation plan

How to confirm the detector is correct before it affects anyone's data. Identify
which real rides can serve as ground truth and what the acceptance bar is. Lap
count matching observed reality is the most practical check.

### 7. Risks and open questions

Anything you found that needs a decision from me.

---

## Decisions already made

Do not relitigate these, but do flag it if the audit reveals one of them is
impractical.

- **Strava first.** Garmin comes later. Design the detector so the source
  specific code is confined to stream normalization.
- **Both detection layers.** Geometry match and kinematic classifier, combined
  into one confidence score rather than run as independent booleans.
- **Silent exclusion in the UI.** Adjusted totals are what the user sees, with no
  callout or interstitial. However, the segment classification and its confidence
  score are persisted so the decision is auditable and tunable later.
- **Raw stream data is never mutated.** Detection produces typed segments;
  derived metrics are computed from those.

---

## Constraints

- The app is live with roughly 90 active users, including professional riders.
  Nothing in this plan should risk corrupting existing ride history.
- Any change to historical metrics must be reversible. Prefer recomputation from
  retained raw data over in place mutation.
- Overpass is a free, rate limited, community run service. Treat it as best
  effort: cache aggressively, key the cache by rounded bounding box so repeat
  visits to the same park are cache hits, and never make a user facing operation
  depend on its availability.
- Detection must be a pure function over points plus lift lines so it can be
  tested against fixtures without network access.

---

## Out of scope

- Garmin import path changes
- Any user facing UI for reviewing or overriding segment classification
- Shuttle lap detection, which is a related but distinct problem
- Retroactive changes to subscription or entitlement logic
