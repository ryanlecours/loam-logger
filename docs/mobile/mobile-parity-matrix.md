# Mobile Parity Matrix

**Created**: 2026-02-09
**Source**: [Web Feature Audit](../audit/web-feature-audit.md)
**Scope**: Features with Status = Confirmed only (excludes Unverified, Incorrect, API-only)

---

## Guardrails

These constraints apply to all mobile implementation work:

### 1. Gate Order Must Match Web
```
AuthGate → TermsGate → OnboardingGate → Tabs (Main App)
```
- Unauthenticated users → `/login`
- `hasAcceptedCurrentTerms: false` → `/onboarding/terms`
- `onboardingCompleted: false` → `/onboarding/age`
- All flags true → `/(tabs)` (dashboard)

### 2. Use `libs/graphql` Hooks Only
- **DO NOT** create duplicate GraphQL strings in `apps/mobile`
- **DO** add new operations to `libs/graphql/src/operations/` if missing
- **DO** import generated hooks from `@loam/graphql`
- Run `npx nx run graphql:codegen` after adding operations

### 3. CSRF is Web-Only
- Web uses HTTP-only cookies + CSRF double-submit pattern
- Mobile uses Bearer tokens via `/auth/mobile/*` endpoints
- **DO NOT** implement CSRF token handling in mobile
- Auth header format: `Authorization: Bearer <accessToken>`

---

## Table of Contents

1. [Parity Matrix](#parity-matrix)
2. [Mobile MVP Scope](#mobile-mvp-scope)
3. [Phase 2 Features](#phase-2-features)

---

## Parity Matrix

### Authentication

| Feature ID | Feature Name | Web | Mobile | MVP | Dependencies | Notes |
|------------|--------------|-----|--------|-----|--------------|-------|
| AUTH-01 | Google OAuth Login | Confirmed | Not started | Yes | Apollo, `/auth/mobile/google` | Uses native Google Sign-In SDK |
| AUTH-02 | Email/Password Login | Confirmed | Not started | Yes | Apollo, `/auth/mobile/login` | POST with email + password |
| AUTH-03 | Email/Password Signup (waitlist) | Confirmed | Not started | Yes | Apollo, `/auth/signup` | Creates WAITLIST role users |
| AUTH-06 | Password Requirements validation | Confirmed | Not started | Yes | `@loam/shared` | Reuse `validatePassword()` from shared lib |
| AUTH-07 | mustChangePassword redirect | Confirmed | Not started | Yes | Auth | Navigate to change password screen when flag set |
| AUTH-08 | Closed Beta Flow (CLOSED_BETA) | Confirmed | Not started | Yes | Auth | Show closed beta info screen |
| AUTH-09 | Closed Beta Flow (ALREADY_ON_WAITLIST) | Confirmed | Not started | Yes | Auth | Show waitlist confirmation screen |
| AUTH-10 | OAuth-only account error handling | Confirmed | Not started | Yes | Auth | Display error for OAuth-only accounts |
| MISSING-05 | Logout Flow | Confirmed | Not started | Yes | Auth, Apollo | Clear tokens from secure storage, reset Apollo cache |

**Excluded**: AUTH-04 (HTTP-only cookie) - Mobile uses Bearer tokens via `/auth/mobile/*` endpoints; AUTH-05 (CSRF) - Not needed for Bearer token auth

### Onboarding

| Feature ID | Feature Name | Web | Mobile | MVP | Dependencies | Notes |
|------------|--------------|-----|--------|-----|--------------|-------|
| ONB-02 | Terms acceptance required | Confirmed | Not started | Yes | Terms, `me` query | Check `hasAcceptedCurrentTerms` flag |
| ONB-03 | Terms version 1.2.0 | Confirmed | Not started | Yes | `@loam/shared` | Use `CURRENT_TERMS_VERSION` constant |
| ONB-04 | Age validation (16-115) | Confirmed | Not started | Yes | Onboarding | Validate age input in step 2 |
| ONB-05 | 99Spokes bike search | Confirmed | Not started | Yes | `searchBikes` query | Auto-complete with metadata |
| ONB-06 | Manual bike entry fallback | Confirmed | Not started | Yes | Onboarding | Toggle when bike not found in 99Spokes |
| ONB-07 | Colorway selection | Confirmed | Not started | No | 99Spokes | Enhancement - can default to first image |
| ONB-08 | Device connections (Strava/Garmin OAuth) | Confirmed | Not started | No | OAuth | Phase 2 - requires deep linking |
| ONB-10 | OnboardingGate redirect | Confirmed | Not started | Yes | Auth, `me` query | Check `onboardingCompleted` flag |
| ONB-11 | Image URL validation (XSS prevention) | Confirmed | Not started | Yes | Security | Validate image URLs before display |

**Excluded**: ONB-09 (sessionStorage) - Mobile uses AsyncStorage/SecureStore

### Dashboard

| Feature ID | Feature Name | Web | Mobile | MVP | Dependencies | Notes |
|------------|--------------|-----|--------|-----|--------------|-------|
| DASH-01 | Priority Bike Selection | Confirmed | Not started | Yes | `BIKES` query | Sort by most urgent component |
| DASH-02 | Two-Phase Bike Loading | Confirmed | Not started | Yes | `BIKES_LIGHT`, `BIKES` | Fast initial render pattern |
| DASH-03 | Unmapped Strava Gear Polling (60s) | Confirmed | Not started | No | Strava | Phase 2 - requires Strava connection |
| DASH-04 | Import Notification Polling (60s) | Confirmed | Not started | No | Import | Phase 2 - requires import feature |
| DASH-05 | Migration Cutoff Date | Confirmed | Not started | No | Migration | Web-only migration for pre-2026-01-29 users |
| DASH-06 | Overlay Sequencing | Confirmed | Not started | No | Overlays | Phase 2 - Import/Calibration/Migration |
| DASH-07 | Recent Rides Count Limit (20) | Confirmed | Not started | Yes | `RIDES` query | `take: 20` for recent rides |
| DASH-08 | Snooze Unmapped Gear Prompt | Confirmed | Not started | No | Strava | Phase 2 - depends on DASH-03 |
| DASH-09 | Migration Auto-Run | Confirmed | Not started | No | Migration | Web-only migration |
| DASH-10 | Pro Users Multi-Bike Switcher | Confirmed | Not started | No | Pro tier | Phase 2 - Pro feature |
| MISSING-08 | DashboardGreeting | Confirmed | Not started | Yes | Stats | Time-of-day greeting + insight |
| MISSING-09 | BikeHealthHero | Confirmed | Not started | Yes | Bikes | Bike cards with health status |

### Rides

| Feature ID | Feature Name | Web | Mobile | MVP | Dependencies | Notes |
|------------|--------------|-----|--------|-----|--------------|-------|
| RIDES-01 | Date Range Filtering | Confirmed | Not started | Yes | `RIDES` query | Filter by `startDate`, `endDate` |
| RIDES-02 | Filter Options (30d/3mo/6mo/1yr) | Confirmed | Not started | Yes | Rides | Preset date range buttons |
| RIDES-03 | Year Selection (back to 2020) | Confirmed | Not started | Yes | Rides | Year picker dropdown |
| RIDES-04 | Cache-and-Network Fetch Policy | Confirmed | Not started | Yes | Apollo | `fetchPolicy: 'cache-and-network'` |
| RIDES-05 | Mass Assign Bike Modal | Confirmed | Not started | No | Bikes | Phase 2 - bulk operation |
| RIDES-06 | Manual Ride Entry | Confirmed | Not started | No | `addRide` mutation | Phase 2 - write operation |
| RIDES-07 | Empty State Message | Confirmed | Not started | Yes | Rides | "No rides logged yet" with hint |
| MISSING-03 | RideStatsCard Sections | Confirmed | Not started | Yes | Stats | 5 expandable sections |
| MISSING-04 | EditRideModal | Confirmed | Not started | No | `updateRide` mutation | Phase 2 - write operation |

### Gear Management

| Feature ID | Feature Name | Web | Mobile | MVP | Dependencies | Notes |
|------------|--------------|-----|--------|-----|--------------|-------|
| GEAR-01 | Spare Component Types Available | Confirmed | Not started | No | Components | Phase 2 - inventory management |
| GEAR-03 | Stock Components Skip Brand/Model | Confirmed | Not started | No | Components | Phase 2 - spare components |
| GEAR-04 | Bike Card Click Navigates to Detail | Confirmed | Not started | Yes | Navigation | Link to bike detail screen |

### Bike Detail

| Feature ID | Feature Name | Web | Mobile | MVP | Dependencies | Notes |
|------------|--------------|-----|--------|-----|--------------|-------|
| DETAIL-01 | Component Sorting by Urgency | Confirmed | Not started | Yes | Components | OVERDUE > DUE_NOW > DUE_SOON > ALL_GOOD |
| DETAIL-02 | LogServiceModal Resets hoursUsed | Confirmed | Not started | No | `logComponentService` mutation | Phase 2 - service logging |
| DETAIL-04 | SwapComponentModal Uses getSlotKey() | Confirmed | Not started | No | `swapComponents` mutation | Phase 2 - component swap |
| DETAIL-05 | Note Field 2000 Char Max | Confirmed | Not started | No | Notes | Phase 2 - applies to notes/modals |
| DETAIL-06 | BikeNotesSection | Confirmed | Not started | Yes | `BIKE_NOTES` query | Read-only notes display |
| DETAIL-07 | AddBikeNoteModal | Confirmed | Not started | No | `addBikeNote` mutation | Phase 2 - write operation |
| DETAIL-08 | Image Editing (99Spokes Only) | Confirmed | Not started | No | 99Spokes | Phase 2 - enhancement |

### Settings

| Feature ID | Feature Name | Web | Mobile | MVP | Dependencies | Notes |
|------------|--------------|-----|--------|-----|--------------|-------|
| SETTINGS-01 | OAuth Callback Handling | Confirmed | Not started | No | OAuth | Phase 2 - deep link handling |
| SETTINGS-02 | Data Source Selector (2+ Providers) | Confirmed | Not started | No | Providers | Phase 2 - requires connections |
| SETTINGS-03 | Success Messages Auto-Dismiss | Confirmed | Not started | Yes | UI | Toast/snackbar with timeout |
| SETTINGS-04 | Disconnect Provider Confirmation | Confirmed | Not started | No | Providers | Phase 2 - requires connections |
| SETTINGS-05 | Delete Account Flow | Confirmed | Not started | Yes | `deleteAccount` mutation | Required for app store compliance |
| SETTINGS-06 | Theme Toggle | Confirmed | Not started | Optional | Theme | Can default to system preference |
| SETTINGS-07 | Hours Display Preference | Confirmed | Not started | Yes | `updateUserPreferences` | Total vs Remaining display |
| SETTINGS-08 | Prediction Algorithm (Pro Only) | Confirmed | Not started | No | Pro tier | Phase 2 - Pro feature |
| SETTINGS-09 | Unsaved Changes Indicator | Confirmed | Not started | Yes | UI | Amber "Unsaved changes" text |
| SETTINGS-10 | Re-calibrate Components | Confirmed | Not started | No | Calibration | Phase 2 - calibration feature |
| MISSING-01 | Theme Toggle (Light/Dark Mode) | Confirmed | Not started | Optional | Theme | Can use system preference |

### Global / Cross-Cutting

| Feature ID | Feature Name | Web | Mobile | MVP | Dependencies | Notes |
|------------|--------------|-----|--------|-----|--------------|-------|
| GLOBAL-01 | Paired Component Types | Confirmed | Not started | Yes | `@loam/shared` | TIRES, BRAKE_PAD, BRAKE_ROTOR, BRAKES |
| GLOBAL-02 | Slot Key Format | Confirmed | Not started | Yes | `@loam/shared` | `${type}_${location}` via `getSlotKey()` |
| GLOBAL-03 | 21 Component Types in Catalog | Confirmed | Not started | Yes | `@loam/shared` | `COMPONENT_CATALOG` array |
| GLOBAL-04 | Component Applicability Rules | Confirmed | Not started | Yes | `@loam/shared` | `isApplicable(spec)` per component |
| GLOBAL-05 | Route Protection Order | Confirmed | Not started | Yes | Auth, Terms, Onboarding | AuthGate → TermsGate → OnboardingGate |
| GLOBAL-06 | User Roles (FREE/PRO/ADMIN) | Confirmed | Not started | Yes | Auth | `isPro`, `isAdmin`, `isFree` |
| GLOBAL-07 | Baseline Wear System | Confirmed | Not started | Yes | `@loam/shared` | NEW/USED/MIXED conditions |
| GLOBAL-08 | Prediction Status Levels | Confirmed | Not started | Yes | Components | ALL_GOOD, DUE_SOON, DUE_NOW, OVERDUE |
| MISSING-10 | AboutAppModal | Confirmed | Not started | No | UI | Phase 2 - nice-to-have |

---

## Mobile MVP Scope

### Screens/Routes

| Screen | Route | Description | Key Features |
|--------|-------|-------------|--------------|
| Login | `/login` | Authentication screen | Google Sign-In, Email/Password, Signup |
| Closed Beta | `/closed-beta` | Beta info for new users | Informational only |
| Waitlist | `/waitlist` | Waitlist confirmation | Informational only |
| Change Password | `/change-password` | Password update | Required after first email login |
| Terms | `/onboarding/terms` | Terms acceptance | Step 1 of onboarding |
| Age | `/onboarding/age` | Age input | Step 2 of onboarding |
| Bike Search | `/onboarding/bike` | 99Spokes search + manual | Steps 3-4 of onboarding |
| Dashboard | `/dashboard` | Main screen | Greeting, bike health cards, recent rides |
| Rides | `/rides` | Ride history | Date filtering, ride list, stats card |
| Gear | `/gear` | Bikes list | Bike cards with health status |
| Bike Detail | `/gear/:bikeId` | Single bike view | Component list (sorted), notes (read-only) |
| Settings | `/settings` | User preferences | Hours display, delete account |

### MVP Feature Count

| Category | Total Features | MVP Features | MVP % |
|----------|----------------|--------------|-------|
| Authentication | 9 | 9 | 100% |
| Onboarding | 8 | 6 | 75% |
| Dashboard | 12 | 6 | 50% |
| Rides | 9 | 7 | 78% |
| Gear | 3 | 1 | 33% |
| Bike Detail | 7 | 2 | 29% |
| Settings | 11 | 5 | 45% |
| Global | 9 | 8 | 89% |
| **Total** | **68** | **44** | **65%** |

### Shared Library Dependencies

The mobile app should reuse these from `@loam/shared`:

| Module | Exports | Usage |
|--------|---------|-------|
| `componentCatalog.ts` | `COMPONENT_CATALOG`, `getSlotKey()`, `PAIRED_COMPONENT_TYPES` | Component definitions |
| `password.ts` | `validatePassword()`, `PASSWORD_REQUIREMENTS` | Password validation |
| `legal/terms.ts` | `CURRENT_TERMS_VERSION` | Terms version check |

### GraphQL Operations to Reuse

| Operation | Type | Purpose |
|-----------|------|---------|
| `ME` | Query | Current user + preferences |
| `BIKES_LIGHT` | Query | Fast bike list |
| `BIKES` | Query | Full bike data with predictions |
| `RIDES` | Query | Ride list with filters |
| `BIKE_NOTES` | Query | Notes for a bike |
| `searchBikes` | Query | 99Spokes search |
| `updateUserPreferences` | Mutation | Save preferences |
| `deleteAccount` | Mutation | Account deletion |
| `acceptTerms` | Mutation | Terms acceptance |

---

## Phase 2 Features

Top features deferred from MVP, ordered by user value:

| Priority | Feature ID | Feature Name | Category | Rationale |
|----------|------------|--------------|----------|-----------|
| 1 | DETAIL-02 | Service Logging | Bike Detail | Core maintenance tracking |
| 2 | RIDES-06 | Manual Ride Entry | Rides | Add rides without device sync |
| 3 | MISSING-04 | Edit Ride | Rides | Modify existing ride data |
| 4 | DETAIL-04 | Component Swap | Bike Detail | Move components between bikes |
| 5 | ONB-08 | Device Connections (OAuth) | Onboarding | Strava/Garmin/WHOOP sync |
| 6 | DASH-03 | Strava Gear Mapping | Dashboard | Auto-assign bikes to rides |
| 7 | SETTINGS-10 | Re-calibrate Components | Settings | Reset baseline wear |
| 8 | DETAIL-07 | Add Bike Note | Bike Detail | Setup snapshots |
| 9 | SETTINGS-08 | Prediction Algorithm (Pro) | Settings | Predictive vs Simple |
| 10 | DASH-10 | Multi-Bike Switcher (Pro) | Dashboard | Quick bike switching |

### Phase 2 Dependencies

```
Service Logging (DETAIL-02)
└── Enables: Calibration (SETTINGS-10)

Device Connections (ONB-08)
├── Enables: Strava Gear Mapping (DASH-03, DASH-08)
├── Enables: Import Polling (DASH-04)
├── Enables: Overlay Sequencing (DASH-06)
└── Enables: Provider Management (SETTINGS-01, SETTINGS-02, SETTINGS-04)

Pro Tier Features
├── Prediction Algorithm (SETTINGS-08)
└── Multi-Bike Switcher (DASH-10)
```

---

## Appendix: Excluded Features

### API-Only (Not Applicable to Mobile)

| Item | Reason |
|------|--------|
| MISSING-06 | Mobile Authentication endpoints - already used by mobile |
| MISSING-07 | Rate Limiting System - server-side enforcement |

### Incorrect Features (Per Audit)

| Feature ID | Feature | Issue |
|------------|---------|-------|
| ONB-01 | Multi-step wizard (7 steps) | UI/progress bar mismatch |
| DETAIL-03 | "Also Replace Pair" option | Does not exist in codebase |

### Unverified Features (Per Audit)

| Feature ID | Feature | Issue |
|------------|---------|-------|
| GEAR-02 | Two-Phase Loading | Pattern claimed but not verified in Gear.tsx |
