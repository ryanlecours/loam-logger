# Drafted reply — Garmin Developer Program ticket

Draft for the reply to Elena Kononova's May 6, 2026 message. Review and adjust
the italicised placeholders before sending. Everything else reflects what is
actually in the codebase as of this change.

**Do not send until:**
- the changes are deployed to production (the reviewer will open the live app);
- the Garmin token migration has been run (see below);
- two Garmin Connect users are authorized on the evaluation key;
- Data Generator and Partner Verification have both been run and captured;
- the developer-program account emails are moved off freemail (see §3 below —
  this is the one item that is not a code change and will otherwise stall the
  ticket).

### Garmin token migration — run once, after deploy

Garmin tokens moved from the plaintext `OauthToken` table to the AES-256-GCM
encrypted `UserIntegration` store. Deploy is safe on its own: any connection
still living in the old table is adopted and encrypted the first time it is
used, so nobody gets disconnected. The script clears out accounts that would
otherwise never sync:

```bash
cd apps/api
DATABASE_URL="…" TOKEN_ENCRYPTION_KEY="…" npx tsx scripts/migrate-garmin-tokens.ts            # dry run
DATABASE_URL="…" TOKEN_ENCRYPTION_KEY="…" npx tsx scripts/migrate-garmin-tokens.ts --execute
```

It is idempotent; re-run until it reports zero rows. After that, the two
remaining legacy read paths (`adoptLegacyPlaintextTokens` in
`lib/garmin-token.ts` and the status-endpoint fallback in
`routes/auth.garmin.ts`) can be deleted.

---

## Draft

Dear Elena,

Thank you for the detailed requirements. We have completed the work across all
four areas and have attached a zipped screenshot pack (no videos, no shared
links) covering every surface where Garmin data appears in our application.

For clarity up front: **Loam Logger requests the Activity API only.** We do not
request, receive, or store Health API data of any kind — no dailies, sleep,
stress, body composition, pulse ox, respiration, HRV, or Body Battery. We also
do not use the Training or Courses APIs; the application never writes workouts
or courses to Garmin Connect, so the workout/course transfer screenshot does not
apply. Our single use of Garmin data is cycling activity duration, which we
convert into bicycle component wear and service predictions.

### 1. Legal

The section of our Privacy Policy describing Garmin data specifically is here:

**https://loamlogger.app/privacy#garmin-connect-data**

Section 4a, "Garmin Connect Data", states:

- exactly which Activity API fields we collect (activity type and name, start
  time, duration, distance, elevation gain, average and maximum heart rate,
  starting coordinates, device model, and per-point samples where provided);
- an explicit statement that no health or wellness data is requested or received;
- how the data is used and processed, including that ride duration is an input
  to derived outputs (component wear, service predictions) and that those
  outputs name Garmin as a contributing source;
- every third party that processes it — our hosting and database providers
  (Railway, Neon, Vercel) — and an explicit statement that Garmin data is **not**
  sent to our analytics (PostHog) or error-tracking (Sentry) providers;
- **third-party AI processing**, disclosed in full: a paid-tier feature generates
  a plain-language maintenance summary using Anthropic, PBC (the Claude API).
  What is transmitted is the *derived* maintenance state only — component names,
  accumulated hours, service intervals, and status. Raw Garmin activity data,
  GPS coordinates, per-point samples, Garmin account identifiers, and the user's
  name and email are not transmitted. Anthropic acts as a sub-processor and does
  not use the data for model training;
- storage location, retention, and deletion, including that disconnection or a
  Garmin-initiated deregistration deletes the raw Garmin-supplied GPS tracks
  automatically.

We understand that any future change to this Privacy Policy in relation to
Garmin data must be submitted to the Garmin Connect Developer Program team for
written approval before implementation, and we will do so.

### 2. Technical Review

Run against our current Evaluation Key using Data Generator and Partner
Verification; captures are in `04-technical/` of the attached archive.

- **Authorization for two Garmin Connect users** — *[confirm and name/describe
  the two evaluation accounts]*.
- **User Deregistration endpoint** — `POST /webhooks/garmin/deregistration`,
  enabled. On receipt we revoke stored tokens, mark the integration revoked,
  remove the account link, and delete the raw per-point GPS tracks Garmin
  supplied. Previously imported ride records are retained as the rider's own
  bicycle maintenance history; this split is stated explicitly in the Privacy
  Policy section linked above.
- **User Permission Change endpoint** — `POST /webhooks/garmin/permissions`,
  enabled. When `ACTIVITY_EXPORT` is no longer present we disable Garmin sync
  for that user immediately by deleting the stored tokens, so no further reads
  are possible until the user re-authorizes.
- **PING/PUSH notification processing** — `POST /webhooks/garmin/activities-ping`
  handles both PING notifications and callbackURL batches. We do not operate a
  pull-only integration. Manual/unprompted pulls are additionally blocked behind
  a verification-mode flag during your review.
- **HTTP 200 sent asynchronously within 30 seconds** — all three endpoints
  acknowledge with HTTP 200 *before* performing any database work; processing
  then continues on a background queue. No handler holds the response open for
  its work.
- **Payload limits** — our Garmin notification endpoints accept up to 10 MB, and
  up to 100 MB on the Activity endpoint. We have automated regression tests
  asserting that oversized Activity payloads are accepted with HTTP 200.
- **Credential storage** — Garmin access and refresh tokens are encrypted at
  rest with AES-256-GCM and are never written in plaintext. They are decrypted
  only in memory at the moment of an API call. Disconnection, a Garmin
  permission revocation, and a Garmin deregistration each overwrite the stored
  ciphertext rather than merely flagging the record, so no usable Garmin
  credential survives any of those events.
- **Training/Courses API** — not requested; the application does not transfer
  workouts or courses to Garmin Connect.

### 3. Team Members and Account Set-up

- Subscribed to the API Blog for change notifications: *[confirm]*.
- All authorized users added to the account per Section 4 of the Start Guide:
  *[confirm]*.
- No generic or non-company-domain addresses are used for developer-program
  access: *[confirm — see the note below]*.
- No third-party integrators are involved, so no NDA applies.

### 4. UX and Brand Compliance Review

We reviewed every surface against the API Brand Guidelines (v6.30.2025),
pages 2 and 4 in particular, and made the following changes. The attached pack
maps each screenshot to the clause it evidences.

**Authenticating applications.** Every connection surface now shows the official
Garmin Connect app tile alongside the full, unabbreviated app name
"Garmin Connect™". Previously these surfaces used a generic icon and a truncated
label; both have been corrected on web and on iOS. The tile is never recolored,
cropped, rotated, animated, or used as an avatar or decoration.

**Title-level and primary displays.** Every dashboard row, ride feed entry, and
overview card sourced from Garmin now carries a "Garmin [device model]"
attribution beside the entry title, above the fold. We read `deviceName` from
the Activity Summary; where Garmin does not report a device, we display "Garmin"
as the data source, per the guidelines.

**Secondary screens.** Ride detail, component ride history, bike history, import
flows, and settings all carry the same attribution in their expanded views.

**Combined or derived data.** This is central to our product, so we want to be
explicit about it. Ride duration accrues against installed components to produce
component wear hours, service predictions, and bicycle health status, and on
paid plans an LLM-generated maintenance summary. All of these are materially
influenced by Garmin device-sourced data, and all of them now carry the
attribution *"Insights derived in part from Garmin device-sourced data."* — used
verbatim from your sample messaging. We do not imply Garmin endorsement of any
prediction, and we do not name any model or algorithm after Garmin.

**Downstream and exported data.** Our publicly shareable bicycle history page
carries the derived-data attribution and the Garmin trademark notice in its
footer, so attribution travels with the data when a rider shares it.

**Attribution is conditional, in both directions.** Garmin branding and
attribution render only where Garmin data actually contributed. Screenshots 24
and 25 in the attached pack show a non-Garmin ride and a bicycle with no Garmin
rides, neither of which displays any Garmin mark or attribution.

**Garmin trademarks.** We use "Garmin Connect™" in full on connection surfaces
and carry the standard trademark notice on public pages. Garmin brand color is
confined to Garmin's own badges and controls and never colors our own interface.

**Route maps.** Where a route map is drawn from Garmin Activity Details samples,
the map carries "Garmin [device model]" adjacent to it.

We would be glad to provide any additional screenshots or clarification.

Best regards,
Ryan LeCours
Loam Labs LLC — Loam Logger
*[named @loamlogger.app address]*

---

## Note on item 3 — read before sending

Item 3 restricts **freemail and non-company-domain accounts** and **generic
addresses** (`support@`, `info@`, `contact@`, `dev@`). Two things to settle
first, because they are the most likely reason for another round trip:

1. The developer-program contact of record is a `gmail.com` address. Move all
   developer-program access to named `@loamlogger.app` addresses before replying.
2. `support@loamlogger.app` appears in the app's Terms and site footer. It is
   fine as a user-facing support address, but it must not be an account on the
   Garmin developer portal or a recipient of Garmin data.

Unrelated to Garmin but worth fixing while you are in there:
`.github/SECURITY.md` lists `security@loamlogger.com` — the only `.com` in the
repo, and almost certainly a typo for `.app`.
