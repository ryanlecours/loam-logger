# Local lift geometry

Lift detection matches a ride against chairlift and gondola lines from
OpenStreetMap. Until this change, `getLiftLines` asked the public Overpass API
for every 0.05° grid cell it had not seen in the last 180 days. Since
2026-10-22 production on Railway cannot reach overpass-api.de at all
(connections refused, then timeouts), so every ride in an unseen area gets
kinematic-only detection, and the admin re-analysis route refuses batches with
503 `OVERPASS_UNAVAILABLE`. About 54 rides wait in scope `pending` and about
960 more in `all`.

This document records the decision, then the operator runbook.

## Recommendation: a local snapshot of every aerialway, in Postgres

Load every OSM `aerialway` way worldwide into Postgres, refresh it twice a
year, and answer every ride from it. Overpass stays only as the fallback for an
environment that has no snapshot loaded.

### Options considered

| | Local snapshot (chosen) | Overpass mirror fallback | Self-hosted Overpass |
|---|---|---|---|
| Ride-time dependency | None: Postgres only | Still a public service per uncached cell | Our own service |
| Works today | Yes, once loaded | Only if a mirror answers Railway; mirrors are as overloaded and have the same "not for automated use" policy | Weeks of setup |
| Cost | Two small tables (about 40,000 rows) | None | A server with hundreds of GB of disk for the planet DB, plus updates |
| Freshness | As of the last refresh (lifts change on a scale of years) | Live, cached 180 days | Live |
| Operations | A command twice a year | None, until every mirror is down | A service to patch, monitor, and keep in sync |

Mirrors fail the same way the primary did: on 2026-10-24 overpass-api.de
flapped between 502 "at capacity" and normal answers from a home machine, and
overpass.kumi.systems and overpass.private.coffee did not answer at all. No
public Overpass instance hosted in the US was found. Mirrors also raise a
trust question: whatever an instance returns becomes the lift geometry for
every ride, and some public mirrors are under Russian registry control (for
example maps.mail.ru), which this project does not use. The public instance's
own 502 page asks automated users to run their own copy. Self-hosting a full
Overpass to look up about 40,000 lines that barely change is out of
proportion.

Size, measured 2026-10-24 with a real snapshot (OSM base 14:39Z):

| | |
|---|---|
| Lines | 40,201 (matches `way["aerialway"]; out count;`), 267,442 points; 6.7 per line on average, median 5, 95th percentile 18 |
| Most common kinds | chair_lift 9,068; station 4,860; platter 4,526; drag_lift 4,148; magic_carpet 3,391; t-bar 2,901; zip_line 2,847; goods 2,466 |
| Snapshot file | 2.98 MB gzipped, 12.4 MB uncompressed |
| Postgres | 30.9 MB for `LiftGeometryLine` with its indexes (22.6 MB table, 8.3 MB indexes); about double while a refresh holds both imports |
| Load | 9 s against a local Postgres; 41.6 MB of WAL |
| Lookup | 11 to 14 ms per ride for `getLiftLines` |
| Fetch | 32 tiles from overpass-api.de in about 37 minutes on a busy day; one tile needed all five attempts |

### Why a new table rather than seeding `OverpassCache`

Seeding `OverpassCache` for every cell that contains a lift does not work on
its own: a cell with no row means "not fetched yet", so every lift-free cell
would still go to Overpass. Negative-caching the rest of the world is 26
million cells at 0.05°. Rows would also go stale after 180 days and send rides
back to Overpass. A dedicated table with an explicit "this import is complete"
marker (`LiftGeometryImport.status = ACTIVE`) makes "no rows here" a real
answer of "no lifts here".

### Design

- `LiftGeometryImport`: one row per load (source, OSM base time, line count,
  status `LOADING` / `ACTIVE` / `SUPERSEDED`).
- `LiftGeometryLine`: one row per aerialway way with its bounding box
  denormalized, so a ride's area is a plain range query (no PostGIS).
- `getLiftLines` keeps its contract (`geometryAvailable`, `liftLines`,
  `reason`). With an active import it answers from Postgres and returns
  `geometryAvailable: true`; with none, or if the read fails, it falls through
  to the existing Overpass path unchanged. The cell grid and the 12-cell
  `too_large` limit apply to both sources, so a ride gets the same area
  searched either way. The worker and the `requireGeometry` deferral need no
  change.
- `POST /api/admin/lift/reanalyze` skips the Overpass probe while an import is
  active, and every response carries `geometrySource` (`local` with the import
  id, OSM base time and line count, or `overpass`).
- A load inserts under a `LOADING` import that no reader sees, then one
  transaction supersedes the old import and activates the new one; the old
  lines are deleted afterwards. A load that dies part way leaves the active
  import untouched.
- Guards: a snapshot is fetched all or nothing (a tile that keeps failing
  aborts the run, because a missing tile would load as "no lifts" there); a
  load refuses fewer than 10,000 lines, a quarter of the real count (a
  regional Overpass instance such as overpass.osm.ch answers a worldwide
  query without error), and refuses a
  snapshot under 90% of the active one. `--allow-shrink` overrides both.

### Source of the snapshot

1. **Overpass, from a machine that can reach it** (default): overpass-api.de,
   the main instance, run by FOSSGIS e.V. (Germany) for the OSM community.
   The world in 45° tiles, one at a time with a 2 s pause, retrying a busy
   tile after 30, 60, 120 and 240 s. A 45° tile takes about 30 s when the
   instance has capacity.
2. **osmium over the US-hosted planet file**, when overpass-api.de will not
   serve it: AWS Open Data publishes the full OSM planet weekly in the
   `osm-pds` bucket (on 2026-10-24 the latest was `2026/planet-261019.osm.pbf`,
   95.5 GB, with an `.md5` beside it). Filter it with osmium and `convert` the
   export (commands below). Heavy, but it needs no third-party service to be
   up and keeps the whole path on US infrastructure.

Endpoint policy, enforced in code:

- `fetch` only talks to overpass-api.de. Any other instance needs
  `--allow-untrusted-endpoint`, meant for one we run ourselves; it must be
  https and cover the whole world.
- A host under `.ru`, `.su` or `.рф` is refused even with that flag, and
  `load` refuses a snapshot file whose recorded source is on one.
- At ride time, an `OVERPASS_API_BASE` on one of those domains is ignored
  (logged as an error) and the default instance is used.

### OpenStreetMap licence (ODbL 1.0)

The snapshot is OSM data, © OpenStreetMap contributors, under the Open
Database License. What that means here (not legal advice):

- **Attribution**: anything users see that is derived from the data, such as
  lift-adjusted ride time or, later, a lift name, needs a visible credit
  "© OpenStreetMap contributors" linking to
  https://www.openstreetmap.org/copyright. This was already true with Overpass;
  the local copy does not change it. The web track map already shows the
  credit on its tiles. When lift segments or names appear in the web or mobile
  UI, the same credit must be on that screen (or on an attribution page it
  links to).
- **Share-alike**: the snapshot is an unmodified, tag-filtered extract. If a
  derivative database is ever published or used to produce public works, the
  ODbL requires offering it (or the changes made to OSM) under the ODbL; an
  unmodified extract is reproducible from OSM with the query in
  `aerialway-snapshot.ts`, so pointing to that satisfies it.
- **Do not commit the snapshot file**: this repository is public, and
  committing the file would distribute the database. Keep it on the operator's
  machine (or private storage).

### Refresh cadence

Twice a year: in **April**, before the northern bike-park season (catches lifts
built the previous summer and mapped over the winter), and in **October**,
before the southern season. A refresh is the same `fetch` and `load`; detection
picks it up on the next ride with no deploy. Rides already analyzed keep their
segments; re-analysis after a refresh is not needed.

### Not changed, possible follow-ups

- The 12-cell `too_large` limit protected Overpass. With local data a larger
  area is a cheap query, so the roughly 12 rides that stay in `degraded`
  because they are too large could get geometry. That changes detection inputs
  for long rides, so it is left for a separate change.
- `OverpassCache` and the Overpass path stay as the fallback. Once production
  has run on the snapshot for a season they could be removed.

## Runbook

All commands run from `apps/api` in a checkout that has this change. Nothing
here runs a migration by hand: the tables arrive through Railway's boot-time
`migrate deploy`.

### 1. Deploy the migration

1. Merge the PR into `staging`. Railway's staging deploy applies
   `20261024120000_lift_geometry_import`. Check the deploy log for "All
   migrations have been successfully applied".
2. Load staging (step 2 with the staging `DATABASE_URL`) and verify (step 3).
3. Open the promotion PR `staging` into `main`. Before merging, check that no
   PR environment was created against production:
   `gh api repos/ryanlecours/loam-logger/deployments --jq '.[].environment' | sort -u`
   should show no `loam-logger-pr-<n>`.
4. Merge; wait for the production deploy to finish.

### 2. Fetch and load the snapshot

```bash
# On a machine that can reach overpass-api.de. About 20 minutes when the
# instance has capacity, longer when it is busy; the log shows each tile.
# If a tile exhausts its retries the run aborts with no snapshot written, but
# finished tiles are kept in ~/aerialways-2026-10.json.gz.tiles/: re-run the
# same command later (quiet hours in Europe help) and it fetches only the rest.
# --fresh discards them. The directory is removed once the file is written.
npx tsx scripts/lift-geometry.ts fetch --out ~/aerialways-2026-10.json.gz
```

If overpass-api.de will not serve it, use osmium over the AWS-hosted planet
instead (pick the newest key under `2026/` in the listing):

```bash
aws s3 ls --no-sign-request s3://osm-pds/2026/ | grep 'osm.pbf$' | tail -1
aws s3 cp --no-sign-request s3://osm-pds/2026/planet-261019.osm.pbf .
aws s3 cp --no-sign-request s3://osm-pds/2026/planet-261019.osm.pbf.md5 .
md5sum planet-261019.osm.pbf; cat planet-261019.osm.pbf.md5   # must match
osmium tags-filter planet-261019.osm.pbf w/aerialway -o aerialways.osm.pbf
osmium export aerialways.osm.pbf -f geojsonseq --add-unique-id=type_id -o aerialways.geojsonseq
npx tsx scripts/lift-geometry.ts convert --geojsonseq aerialways.geojsonseq \
  --out ~/aerialways-2026-10.json.gz --osm-base 2026-10-19T00:00:00Z   # the planet's date
```

Load it. `load` is a dry run unless `--execute` is given, and always prints the
target host first; check it before adding `--execute`. Set `DATABASE_URL`
explicitly for the target (staging: the staging URL; production: the URL in
`.env.production.local`).

```bash
DATABASE_URL="<target>" npx tsx scripts/lift-geometry.ts load --in ~/aerialways-2026-10.json.gz
DATABASE_URL="<target>" npx tsx scripts/lift-geometry.ts load --in ~/aerialways-2026-10.json.gz --execute
DATABASE_URL="<target>" npx tsx scripts/lift-geometry.ts status
```

`status` should list one `ACTIVE` import whose stored line count equals its
line count.

### 3. Verify

From a signed-in admin tab:

1. `POST /api/admin/lift/reanalyze { "dryRun": true }`: the response's
   `geometrySource.kind` is `local`, with the import's line count.
2. `POST /api/admin/lift/analyze/<rideId>` for a known bike-park ride, then
   check its segments have a non-null `geometryScore`.

### 4. Re-run the stalled re-analysis

Use the batch loop from the PR 388 description (it waits on
`GET /api/admin/lift/queue` and handles the 409). With a snapshot active the
route no longer probes Overpass, so `OVERPASS_UNAVAILABLE` should not appear;
if it does, `geometrySource` will say `overpass`, meaning no import is active
in that environment.

1. Dry run for counts.
2. Walk scope `pending` (the rides whose jobs gave up on 2026-10-22).
3. Walk scope `all` (the remaining backfill set, about 960 rides).
4. Walk scope `pending` again for any job that gave up during step 3.
5. Dry run again. Expected: `degraded` at about 12 (rides too large for the
   geometry layer, kinematic-only by design) and `pending` a small residue of
   streams with no altitude.

Jobs no longer wait on Overpass pacing, so batches drain much faster; the 409
still keeps them from stacking.

Done on production 2026-10-24: analyzed 1,049, degraded 12, pending 0.

### 5. Scan Strava rides that never had a track (scope `unfetched`)

The walk above only reaches rides with a stored stream. A Strava ride's
stream is fetched on its first lift job, so Strava rides imported before lift
detection, or never queued, have none and were never scanned (about 1,574 on
production on 2026-10-24, across 32 users). Scope `unfetched` queues them;
each job fetches the stream from Strava, stores it, and runs detection.
Rides whose owner has disconnected Strava are left out, since there is no
token to fetch with.

Each job is one Strava API read from the app-wide budget that live syncing
also uses. Batches default to 25 (cap 50), and a batch is refused with 429
`STRAVA_BUDGET` when it would take the 15-minute or daily read usage past
half the limit. Usage is the higher of what Strava last reported in its
response headers and the stream fetches the API counts itself; limits are
the ones Strava reported, or its standard read limits when no headers have
been seen. If the count cannot be read the batch is refused. (The first
version trusted the headers alone and allowed a batch whenever none had been
recorded; on 2026-10-24 none ever were, and three batches went through
unchecked before the walk was stopped.) At
the default read limits (100 per 15 minutes, 1,000 a day) that is about 500
rides a day, so the walk takes three to four days; leave the loop running.
In the batch loop, wait `details.retryAfter` seconds on that code:

```js
if (res.code === 'STRAVA_BUDGET') {
  console.warn(res.error);
  await sleep((res.details.retryAfter + 5) * 1000);
  continue;
}
```

`counts.unfetched` will not reach zero: activities with no GPS stream (Strava
returns none) or no altitude keep no stream, and the cursor walks past them.
Each such ride costs a Strava read every time a walk reaches it, so if the
loop stops, resume it from its last `nextCursor` rather than starting over.

The budget check reads usage Strava reported after the previous batch: a new
batch is refused with 409 until the lift queue has drained, so by then every
read of the previous batch has happened and been recorded.

### Refresh (April and October)

Repeat step 2 against production. The load refuses a snapshot under 90% of
the active one; if lifts really were removed on that scale, re-run with
`--allow-shrink`.
