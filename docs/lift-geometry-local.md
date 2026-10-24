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
| Cost | Two small tables (tens of thousands of rows) | None | A server with hundreds of GB of disk for the planet DB, plus updates |
| Freshness | As of the last refresh (lifts change on a scale of years) | Live, cached 180 days | Live |
| Operations | A command twice a year | None, until every mirror is down | A service to patch, monitor, and keep in sync |

Mirrors fail the same way the primary did: on 2026-10-24 overpass-api.de
answered 502 "at capacity" from a home machine, overpass.kumi.systems and
overpass.private.coffee did not answer at all, and only maps.mail.ru served a
query. The public instance's own 502 page asks automated users to run their
own copy. Self-hosting a full Overpass to look up a few tens of thousands of
lines that barely change is out of proportion.

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
  load refuses fewer than 10,000 lines (a regional Overpass instance such as
  overpass.osm.ch answers a worldwide query without error) and refuses a
  snapshot under 90% of the active one. `--allow-shrink` overrides both.

### Source of the snapshot

1. **Overpass, from a machine that can reach it** (default): the world in 45°
   tiles, one at a time with a 2 s pause, retrying a busy tile after 30, 60,
   120 and 240 s. Use `--endpoint` for another instance. As of 2026-10-24,
   maps.mail.ru answered when overpass-api.de did not.
2. **osmium, when no Overpass instance will serve it**: filter a planet file
   or Geofabrik continent extracts, then `convert` the export (commands
   below). Heavy (the planet is about 80 GB) but needs no third-party service
   to be up.

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
# On a machine that can reach an Overpass instance. Takes 10 minutes to a few
# hours depending on how busy the instance is; the log shows each tile.
npx tsx scripts/lift-geometry.ts fetch --out ~/aerialways-2026-10.json.gz \
  --endpoint https://maps.mail.ru/osm/tools/overpass/api/interpreter
```

If no Overpass instance will serve it, use osmium instead (Geofabrik
continent extracts work too; run each and concatenate the `.geojsonseq`
files):

```bash
osmium tags-filter planet-latest.osm.pbf w/aerialway -o aerialways.osm.pbf
osmium export aerialways.osm.pbf -f geojsonseq --add-unique-id=type_id -o aerialways.geojsonseq
npx tsx scripts/lift-geometry.ts convert --geojsonseq aerialways.geojsonseq \
  --out ~/aerialways-2026-10.json.gz --osm-base <the extract's date, ISO>
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

### Refresh (April and October)

Repeat step 2 against production. The load refuses a snapshot under 90% of
the active one; if lifts really were removed on that scale, re-run with
`--allow-shrink`.
