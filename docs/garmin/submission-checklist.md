# Garmin Production Key — Screenshot Capture Checklist

Evidence pack for the Developer Program ticket (opened May 6, 2026). Garmin asked
for screenshots of the evaluation app **for each API requested**, zipped — no
videos, no shared-folder links.

Requested API: **Activity API only.** There is no Health API integration to
screenshot; see `ticket-reply.md` §2.

Reference: Garmin Developer API Brand Guidelines v6.30.2025 —
https://developer.garmin.com/downloads/brand/Garmin-Developer-API-Brand-Guidelines.pdf

---

## Before capturing

1. Sign in as a Garmin-connected evaluation account with **at least two** synced
   cycling activities, at least one of which has Activity Details samples (so
   the route map renders).
2. Confirm the account has a bike with installed components and some accrued
   hours — otherwise the derived-data surfaces have nothing to attribute.
3. Set `GARMIN_VERIFICATION_MODE=true` before any Partner Verification run so
   unprompted pulls stay blocked.
4. Capture at a normal desktop width (≥1280px). Do not crop out the attribution
   — its position relative to the data is the thing under review.
5. Use a second Garmin account for the "two authorized users" evidence.

---

## Web — capture in this order

| # | Screen | Route | What must be visible | Guideline clause |
|---|---|---|---|---|
| 1 | Onboarding → connect providers | `/onboarding?step=6` | Garmin Connect™ tile + full app name on the connect row | Authenticating Applications |
| 2 | Garmin OAuth consent | Garmin-hosted | The consent screen as the rider sees it | UX flow |
| 3 | OAuth completion page | `/auth/garmin/callback` → redirect | "Garmin Connect™" naming on the completion page | Authenticating Applications |
| 4 | Settings → Data Sources, connected | `/settings` | Provider card with the Garmin Connect™ tile and full app name | Authenticating Applications |
| 5 | Settings → active data source picker | `/settings` (2+ providers connected) | Garmin card with real tile, not a substitute glyph | Authenticating Applications |
| 6 | Dashboard | `/dashboard` | Recent-ride rows showing **"Garmin Edge 840"** beside each ride title, above the fold | Title-Level / Primary Displays |
| 7 | Dashboard → AI maintenance summary | `/dashboard` | Summary card with *"Insights derived in part from Garmin device-sourced data."* directly beneath it | Combined or Derived Data |
| 8 | Rides list | `/rides` | Per-ride "Garmin [device model]" badge in the header row of each card | Title-Level / Primary Displays |
| 9 | Ride detail → route map | `/rides` → open a Garmin ride | Map plus "Data source: Garmin [device model]" adjacent to it | Visual and Social Media |
| 10 | Bike detail → Component Health | `/gear/:bikeId` | Derived-data attribution directly under the section heading, above the component list | Combined or Derived Data |
| 11 | Component ride history | `/gear/:bikeId` → component → rides | Per-entry Garmin attribution in the ride list | Secondary Screens |
| 12 | Bike history | `/gear/:bikeId/history` | Attribution retained on the historical view | Secondary Screens |
| 13 | **Public shared bike history** | `/share/:slug` (signed out) | Footer carries the derived-data line **and** the Garmin trademark notice | Downstream and Exported Data |
| 13b | **Exported PDF history** (Pro) | `/gear/:bikeId/history` → Export PDF | Attribution + trademark notice repeated in the footer of **every page** — capture a multi-page export | Downstream and Exported Data |
| 14 | Import Garmin rides modal | `/settings` → Sync Previous | Garmin Connect™ naming through the import flow | Secondary Screens |
| 15 | Disconnect confirmation | `/settings` → Disconnect | The disconnect path and its confirmation copy | UX flow |
| 16 | Privacy policy, Garmin section | `/privacy#garmin-connect-data` | The anchor resolving to §4a with the section heading visible | Item 1 (Legal) |

## Mobile (iOS) — same product, same rules

| # | Screen | What must be visible |
|---|---|---|
| 17 | Onboarding → connect | Garmin Connect™ full name on the provider row |
| 18 | Settings → Connected Services | Garmin Connect™ row |
| 19 | Settings → data source picker | Garmin Connect™ card with the real app tile |
| 20 | Rides tab | Per-ride "Garmin [device model]" badge |
| 21 | Ride detail | "Garmin [device model]" badge in the header |
| 22 | Component ride list | Per-entry Garmin attribution |
| 23 | Settings → Privacy Policy → §4a | The Garmin Connect Data section in-app |

## Negative controls — include these, they answer the reviewer's next question

| # | Screen | What it proves |
|---|---|---|
| 24 | A Strava-only or manually-entered ride in the rides list | No Garmin branding appears where Garmin contributed nothing |
| 25 | A bike whose hours contain no Garmin rides | No Garmin derived-data attribution on its Component Health section |

The guidelines forbid using the Garmin mark "in instances where Garmin
device-sourced data is not present." Showing that the attribution is *conditional*
is stronger evidence than showing it is merely present.

---

## Technical review evidence (item 2)

Capture alongside the UI screenshots:

- **Data Generator** run: request and the 200 response, for Activity,
  deregistration, and user-permission notifications.
- **Partner Verification** run: full pass output against the evaluation key.
- Two distinct Garmin Connect users authorized (Settings screenshot from each,
  or the developer-portal user list).
- A >100 KB and a >10 MB Activity payload accepted with HTTP 200 (the
  regression tests in `apps/api/src/routes/webhooks.garmin.test.ts` under
  "payload size limits" cover this in CI; a live capture is stronger).
- Training/Courses API: **not applicable** — Loam Logger never writes to Garmin.

---

## Packaging

```
garmin-submission-2026-07/
  01-web/           screenshots 1–16, numbered to match this table
  02-mobile/        screenshots 17–23
  03-negative/      screenshots 24–25
  04-technical/     Data Generator + Partner Verification captures
  README.txt        one line per file mapping it to the guideline clause
```

Zip that directory. Do not attach videos or share a cloud-drive link — Garmin
rejects both.
