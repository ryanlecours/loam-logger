# Web App Feature Audit Report

**Audit Date**: 2026-02-09
**Scope**: `apps/web` (React frontend) with cross-references to `apps/api` and `libs/shared`
**Baseline Document**: `C:\Users\lecou\.claude\plans\magical-dreaming-leaf.md`

---

## Table of Contents

1. [Authentication & Session Management](#1-authentication--session-management)
2. [Onboarding](#2-onboarding)
3. [Dashboard](#3-dashboard)
4. [Rides](#4-rides)
5. [Gear Management](#5-gear-management)
6. [Bike Detail](#6-bike-detail)
7. [Settings](#7-settings)
8. [Global / Cross-Cutting Rules](#8-global--cross-cutting-rules)
9. [Confidence Warnings](#9-confidence-warnings)
10. [Missing Coverage](#10-missing-coverage)

---

## 1. Authentication & Session Management

| Feature ID | Feature/Behavior | Status | Evidence | Notes |
|------------|------------------|--------|----------|-------|
| AUTH-01 | Google OAuth Login | Confirmed | `apps/web/src/pages/Login.tsx` (GoogleLogin component), `apps/api/src/auth/google.route.ts` | Uses `@react-oauth/google` library; credential sent to POST `/auth/google/code` |
| AUTH-02 | Email/Password Login | Confirmed | `apps/web/src/pages/Login.tsx`, `apps/api/src/auth/email.route.ts` | POST `/auth/login` endpoint |
| AUTH-03 | Email/Password Signup (waitlist) | Confirmed | `apps/web/src/pages/Login.tsx`, `apps/api/src/auth/email.route.ts` | Creates users with WAITLIST role; POST `/auth/signup` |
| AUTH-04 | Session Persistence via HTTP-only cookie | Confirmed | `apps/api/src/auth/session.ts` - `setSessionCookie()` | Cookie name: `ll_session`; 7-day expiry |
| AUTH-05 | CSRF Protection | Confirmed | `apps/web/src/lib/csrf.ts` (`setCsrfToken`, `getCsrfToken`, `getAuthHeaders`), `apps/api/src/auth/csrf.ts` | Cookie: `ll_csrf`, header: `x-csrf-token`; double-submit pattern |
| AUTH-06 | Password Requirements validation | Confirmed | `libs/shared/src/password.ts` - `PASSWORD_REQUIREMENTS`, `validatePassword()` | 8 chars min, upper/lower/number required; special chars: `!@#$%^&*` |
| AUTH-07 | mustChangePassword redirect | Confirmed | `apps/web/src/pages/Login.tsx` (checks flag), `apps/web/src/pages/ChangePassword.tsx` | Backend clears flag on successful change |
| AUTH-08 | Closed Beta Flow (CLOSED_BETA code) | Confirmed | `apps/web/src/pages/Login.tsx`, `apps/api/src/auth/google.route.ts` | Redirects new users to `/closed-beta` |
| AUTH-09 | Closed Beta Flow (ALREADY_ON_WAITLIST code) | Confirmed | `apps/web/src/pages/Login.tsx`, `apps/api/src/auth/email.route.ts` | Redirects existing waitlist users to `/already-on-waitlist` |
| AUTH-10 | OAuth-only account error handling | Confirmed | `apps/api/src/auth/email.route.ts` | Returns specific error when email/password login attempted on OAuth-only accounts |

---

## 2. Onboarding

| Feature ID | Feature/Behavior | Status | Evidence | Notes |
|------------|------------------|--------|----------|-------|
| ONB-01 | Multi-step wizard (7 steps) | Incorrect | `apps/web/src/pages/Onboarding.tsx:437` ("Step X of 8"), `:404` (`progressPercentage = currentStep / 7`) | UI displays "Step X of 8" but progress bar calculates based on 7 steps; inconsistency in code |
| ONB-02 | Terms acceptance required | Confirmed | `apps/web/src/components/TermsGate.tsx`, `apps/web/src/components/TermsAcceptanceStep.tsx` | Checks `user.hasAcceptedCurrentTerms`; redirects to `/onboarding?step=1` if false |
| ONB-03 | Terms version 1.2.0 | Confirmed | `libs/shared/src/legal/terms.ts` - `CURRENT_TERMS_VERSION = '1.2.0'` | Single source of truth for version |
| ONB-04 | Age validation (16-115) | Confirmed | `apps/web/src/pages/Onboarding.tsx:286-289` | Error message: "Age must be between 16 and 115" |
| ONB-05 | 99Spokes bike search | Confirmed | `apps/web/src/components/BikeSearch.tsx`, `apps/web/src/hooks/useSpokes.ts` | Auto-complete with metadata auto-fill |
| ONB-06 | Manual bike entry fallback | Confirmed | `apps/web/src/pages/Onboarding.tsx:616-693` | Toggle via "Enter bike details manually" link |
| ONB-07 | Colorway selection | Confirmed | `apps/web/src/pages/Onboarding.tsx:704-748`, `apps/web/src/components/BikeImageSelector.tsx` | Step 5; uses `data.bikeImages` from 99Spokes |
| ONB-08 | Device connections (Strava/Garmin OAuth) | Confirmed | `apps/web/src/pages/Onboarding.tsx:751-844` | Step 6; redirects to OAuth endpoints |
| ONB-09 | Session storage persistence for OAuth redirects | Confirmed | `apps/web/src/pages/Onboarding.tsx:150-156` | Key: `onboarding_data` in sessionStorage |
| ONB-10 | OnboardingGate redirect | Confirmed | `apps/web/src/components/OnboardingGate.tsx` | Checks `user.onboardingCompleted`; redirects to `/onboarding` if false |
| ONB-11 | Image URL validation (XSS prevention) | Confirmed | `apps/web/src/utils/bikeFormHelpers.ts` - `isValidImageUrl()` | Called before displaying bike images |

---

## 3. Dashboard

| Feature ID | Feature/Behavior | Status | Evidence | Notes |
|------------|------------------|--------|----------|-------|
| DASH-01 | Priority Bike Selection | Confirmed | `apps/web/src/hooks/usePriorityBike.ts` | Returns `displayedBike`, `isShowingPriority`, `selectBike()`, `resetToPriority()`, `sortedBikes` |
| DASH-02 | Two-Phase Bike Loading | Confirmed | `apps/web/src/pages/Dashboard.tsx:75-98` | `BIKES_LIGHT` first, then `BIKES` with `skip: !bikesLightData` |
| DASH-03 | Unmapped Strava Gear Polling (60s) | Confirmed | `apps/web/src/pages/Dashboard.tsx:100-103` | `pollInterval: 60000` on `UNMAPPED_STRAVA_GEARS` query |
| DASH-04 | Import Notification Polling (60s) | Confirmed | `apps/web/src/pages/Dashboard.tsx:107-109` | `pollInterval: 60000` via `useImportNotificationState` |
| DASH-05 | Migration Cutoff Date | Confirmed | `apps/web/src/pages/Dashboard.tsx:32` | `MIGRATION_CUTOFF_DATE = new Date('2026-01-29T23:59:59Z')` |
| DASH-06 | Overlay Sequencing (Import → Calibration → Migration) | Confirmed | `apps/web/src/pages/Dashboard.tsx:173-182, 209-217` | Guards prevent overlapping: `!isImportOverlayOpen && !isCalibrationOpen` |
| DASH-07 | Recent Rides Count Limit | Confirmed | `apps/web/src/pages/Dashboard.tsx:50` | `RECENT_COUNT = 20` |
| DASH-08 | Snooze Unmapped Gear Prompt | Confirmed | `apps/web/src/pages/Dashboard.tsx:222-227` | Checks `localStorage.getItem('loam-strava-mapping-snoozed')` |
| DASH-09 | Migration Auto-Run for Pre-Cutoff Users | Confirmed | `apps/web/src/pages/Dashboard.tsx:141-158` | Idempotent; guarded by `hasMigrationRun` state |
| DASH-10 | Pro Users Multi-Bike Switcher | Confirmed | `apps/web/src/pages/Dashboard.tsx:260-265` | `{isPro && sortedBikes.length > 1 && <BikeSwitcherRow />}` |

---

## 4. Rides

| Feature ID | Feature/Behavior | Status | Evidence | Notes |
|------------|------------------|--------|----------|-------|
| RIDES-01 | Date Range Filtering | Confirmed | `apps/web/src/pages/Rides.tsx:20-85` | `getDateRangeFilter()` converts selection to ISO range |
| RIDES-02 | Filter Options (30d/3mo/6mo/1yr) | Confirmed | `apps/web/src/pages/Rides.tsx:36-42` | `getDateRangeLabel()` function |
| RIDES-03 | Year Selection (back to 2020) | Confirmed | `apps/web/src/pages/Rides.tsx:25-32` | `getYearOptions()` loop from current year to 2020 |
| RIDES-04 | Cache-and-Network Fetch Policy | Confirmed | `apps/web/src/pages/Rides.tsx:91-96` | `fetchPolicy: 'cache-and-network'` |
| RIDES-05 | Mass Assign Bike Modal | Confirmed | `apps/web/src/pages/Rides.tsx:236-242`, `apps/web/src/components/MassAssignBikeModal.tsx` | Bulk assign bike to filtered rides |
| RIDES-06 | Manual Ride Entry | Confirmed | `apps/web/src/pages/Rides.tsx:122`, `apps/web/src/components/AddRideForm.tsx` | `<AddRideForm onAdded={() => refetch()} />` |
| RIDES-07 | Empty State Message | Confirmed | `apps/web/src/pages/Rides.tsx:215-219` | "No rides logged yet" with hint to connect Garmin |

---

## 5. Gear Management

| Feature ID | Feature/Behavior | Status | Evidence | Notes |
|------------|------------------|--------|----------|-------|
| GEAR-01 | Spare Component Types Available | Confirmed | `apps/web/src/components/SpareComponentForm.tsx:7-24`, `apps/web/src/components/gear/SpareComponentsPanel.tsx:56-59` | FORK, SHOCK, DROPPER, WHEEL_HUBS with icons |
| GEAR-02 | Two-Phase Loading (GEAR_QUERY_LIGHT then GEAR_QUERY) | Unverified | Pattern exists in Dashboard; needs verification in `apps/web/src/pages/Gear.tsx` | Claimed but not directly verified |
| GEAR-03 | Stock Components Skip Brand/Model | Confirmed | `apps/web/src/components/SpareComponentForm.tsx` | `isStock` field allows skipping brand/model entry |
| GEAR-04 | Bike Card Click Navigates to Detail | Confirmed | `apps/web/src/components/gear/BikeOverviewCard.tsx` | Links to `/gear/:bikeId` |

---

## 6. Bike Detail

| Feature ID | Feature/Behavior | Status | Evidence | Notes |
|------------|------------------|--------|----------|-------|
| DETAIL-01 | Component Sorting by Urgency | Confirmed | `apps/web/src/pages/BikeDetail.tsx:125-154` | `statusOrder`: OVERDUE=0, DUE_NOW=1, DUE_SOON=2, ALL_GOOD=3; secondary sort by hours remaining |
| DETAIL-02 | LogServiceModal Resets hoursUsed to 0 | Confirmed | `apps/api/src/graphql/resolvers.ts:1974` | `data: { hoursUsed: 0 }` in transaction |
| DETAIL-03 | ReplaceComponentModal "Also Replace Pair" Option | Incorrect | Grep found no "pair" in `apps/web/src/components/gear/ReplaceComponentModal.tsx` | Feature does NOT exist; remove from inventory |
| DETAIL-04 | SwapComponentModal Uses getSlotKey() | Confirmed | `apps/web/src/components/gear/SwapComponentModal.tsx:3-4, 86-87` | Imports from `@loam/shared`; creates slotKeyA and slotKeyB |
| DETAIL-05 | Note Field 2000 Char Max | Confirmed | `ReplaceComponentModal.tsx:331`, `SwapComponentModal.tsx:142`, `AddBikeNoteModal.tsx:15` | `maxLength={2000}` or `MAX_NOTE_LENGTH = 2000` |
| DETAIL-06 | BikeNotesSection Component | Confirmed | `apps/web/src/components/gear/BikeNotesSection.tsx` | Expandable notes with pagination, BIKE_NOTES_QUERY |
| DETAIL-07 | AddBikeNoteModal Component | Confirmed | `apps/web/src/components/gear/AddBikeNoteModal.tsx` | Includes snapshot message; ADD_BIKE_NOTE mutation |
| DETAIL-08 | Image Editing (99Spokes Only) | Confirmed | `apps/web/src/pages/BikeDetail.tsx:404-414` | "Change Image" button only renders if `bike.spokesId` exists |

---

## 7. Settings

| Feature ID | Feature/Behavior | Status | Evidence | Notes |
|------------|------------------|--------|----------|-------|
| SETTINGS-01 | OAuth Callback Handling | Confirmed | `apps/web/src/pages/Settings.tsx:73-102` | Parses `?garmin=connected`, `?strava=connected`, `?whoop=connected` |
| SETTINGS-02 | Data Source Selector (2+ Providers) | Confirmed | `apps/web/src/pages/Settings.tsx:548` | Conditional render: `[isGarminConnected, isStravaConnected, isWhoopConnected].filter(Boolean).length >= 2` |
| SETTINGS-03 | Success Messages Auto-Dismiss | Confirmed | `apps/web/src/pages/Settings.tsx:77, 87-88, 98-99` | `setTimeout(() => setSuccessMessage(null), 3000-8000)` |
| SETTINGS-04 | Disconnect Provider Confirmation | Confirmed | `apps/web/src/pages/Settings.tsx:142-144, 164-166, 187-189` | `confirm()` dialog before disconnect |
| SETTINGS-05 | Delete Account Flow | Confirmed | `apps/web/src/pages/Settings.tsx:347-370`, `apps/web/src/components/DeleteAccountModal.tsx` | Confirmation modal; redirects to `/login` after deletion |
| SETTINGS-06 | Theme Toggle | Confirmed | `apps/web/src/pages/Settings.tsx` (imports ThemeToggle), `apps/web/src/components/ThemeToggleButton.tsx` | Light/dark mode toggle; uses `useTheme()` hook |
| SETTINGS-07 | Hours Display Preference (Total/Remaining) | Confirmed | `apps/web/src/pages/Settings.tsx:694-736` | Radio buttons; `hoursDisplay` state |
| SETTINGS-08 | Prediction Algorithm (Pro Only) | Confirmed | `apps/web/src/pages/Settings.tsx:649-692` | `{isPro && ...}` guard; Simple vs Predictive |
| SETTINGS-09 | Unsaved Changes Indicator | Confirmed | `apps/web/src/pages/Settings.tsx:345, 746-748` | `hasUnsavedChanges` computed; amber "Unsaved changes" text |
| SETTINGS-10 | Re-calibrate Components | Confirmed | `apps/web/src/pages/Settings.tsx:761-769` | Calls `resetCalibration()` then navigates to `/dashboard` |

---

## 8. Global / Cross-Cutting Rules

| Feature ID | Feature/Behavior | Status | Evidence | Notes |
|------------|------------------|--------|----------|-------|
| GLOBAL-01 | Paired Component Types | Confirmed | `libs/shared/src/componentCatalog.ts:53` | `PAIRED_COMPONENT_TYPES = ['TIRES', 'BRAKE_PAD', 'BRAKE_ROTOR', 'BRAKES']` |
| GLOBAL-02 | Slot Key Format | Confirmed | `libs/shared/src/componentCatalog.ts:354-356` | `getSlotKey(type, location)` returns `${type}_${location}` |
| GLOBAL-03 | 21 Component Types in Catalog | Confirmed | `libs/shared/src/componentCatalog.ts:60-277` | `COMPONENT_CATALOG` array with all definitions |
| GLOBAL-04 | Component Applicability Rules | Confirmed | `libs/shared/src/componentCatalog.ts` | `isApplicable(spec)` function per component |
| GLOBAL-05 | Route Protection Order | Confirmed | `apps/web/src/App.tsx` | AuthGate → TermsGate → OnboardingGate → AppShell → Page |
| GLOBAL-06 | User Roles (FREE/PRO/ADMIN) | Confirmed | `apps/web/src/hooks/useUserTier.ts` | Returns `isPro`, `isAdmin`, `isFree`, `isFoundingRider` |
| GLOBAL-07 | Baseline Wear System | Confirmed | `libs/shared/src/types/bike.ts`, `libs/shared/src/componentCatalog.ts` | `AcquisitionCondition`: NEW/USED/MIXED; `BaselineMethod`: DEFAULT/SLIDER/DATES |
| GLOBAL-08 | Prediction Status Levels | Confirmed | `apps/web/src/types/prediction.ts` | ALL_GOOD, DUE_SOON, DUE_NOW, OVERDUE with severity ordering |

---

## 9. Confidence Warnings

### Backend-Only Evidence for Web Features

| Feature ID | Issue |
|------------|-------|
| AUTH-04 | Session cookie implementation cited from `apps/api/src/auth/session.ts`; web consumption not directly verified |
| AUTH-10 | OAuth-only error cited from API only; web error display not verified |
| DETAIL-02 | hoursUsed reset verified only in `apps/api/src/graphql/resolvers.ts:1974`; web mutation call not traced |

### Speculative Claims (Directory/Pattern Presence Only)

| Feature ID | Issue |
|------------|-------|
| GEAR-02 | Two-phase loading pattern claimed based on Dashboard implementation; `Gear.tsx` not directly verified |
| ONB-11 | `isValidImageUrl()` function existence confirmed; actual call sites not traced |

### Inconsistencies Detected

| Feature ID | Issue |
|------------|-------|
| ONB-01 | Code inconsistency: UI shows "Step X of 8" but progress calculates `currentStep / 7`; likely a bug |

---

## 10. Missing Coverage (Re-Audited)

The following features exist in the codebase but were not documented in the original inventory. Each has been re-audited for accuracy.

| # | Feature | Re-Audit Status | Evidence | Category |
|---|---------|-----------------|----------|----------|
| 1 | Theme Toggle (Light/Dark Mode) | **Confirmed** | `ThemeProvider.tsx` (localStorage + system pref), `ThemeContext.ts`, `useTheme.ts`, `ThemeToggleButton.tsx` | Settings |
| 2 | User Roles/Tiers System | **Confirmed** | `useUserTier.ts:3-12` - `UserRole = 'FREE' \| 'PRO' \| 'ADMIN'`; returns `isPro`, `isAdmin`, `isFree`, `isFoundingRider` | Global |
| 3 | RideStatsCard Detailed Sections | **Confirmed** | `RideStatsCard/index.tsx:175-226` - 5 ExpandableSections: RideCountSection, TrendsSection, HeartRateSection, LocationSection, BikeUsageSection | Rides |
| 4 | EditRideModal | **Confirmed** | `EditRideModal.tsx` - Full modal with UPDATE_RIDE mutation; fields: startTime, hours/minutes, distance, elevation, averageHr, rideType, bikeId, notes, trailSystem, location | Rides |
| 5 | Logout Flow Implementation | **Confirmed** | `AppShell.tsx` - `handleLogout()`: POST `/auth/logout`, `clearCsrfToken()`, Apollo cache clear | Auth |
| 6 | Mobile Authentication (Bearer tokens) | **Confirmed (API-only)** | `mobile.route.ts:1-214` - `/mobile/google`, `/mobile/apple` (placeholder), `/mobile/login`, `/mobile/refresh`; returns accessToken + refreshToken | Auth |
| 7 | Rate Limiting System | **Confirmed (API-only)** | `rate-limit.ts` - `AUTH_RATE_LIMITS.signup` (5/min/IP), `MUTATION_RATE_LIMITS` (20 operations), `QUERY_RATE_LIMITS`, `ADMIN_RATE_LIMITS`; Redis with in-memory fallback | Auth |
| 8 | DashboardGreeting Component | **Confirmed** | `DashboardGreeting/index.tsx` - Time-of-day greeting + contextual insight; uses `useGreetingInsight()` hook for stats-based messages | Dashboard |
| 9 | BikeHealthHero Component | **Confirmed** | `BikeHealthHero/index.tsx` - Aggregates bike health counts, renders DashboardGreeting + quick actions (Log Ride, Upload GPX) + BikeHealthCard grid; admin dev mode buttons | Dashboard |
| 10 | AboutAppModal | **Confirmed** | `AboutAppModal.tsx` - 3 tabs (About/What's New/Roadmap); hardcoded changelog entries; keyboard nav (arrow keys) | Global |

### Re-Audit Details

#### 1. Theme Toggle (Light/Dark Mode)
- **ThemeProvider** (`apps/web/src/providers/ThemeProvider.tsx`): Initializes from `localStorage.getItem('theme')` or system preference via `window.matchMedia('(prefers-color-scheme: dark)')`
- **Persistence**: Saves to `localStorage.setItem('theme', theme)` on toggle
- **Context**: `ThemeContext` exports `theme`, `toggleTheme`, `setTheme`

#### 2. User Roles/Tiers System
```typescript
// apps/web/src/hooks/useUserTier.ts
export type UserRole = 'FREE' | 'PRO' | 'ADMIN';
export function useUserTier() {
  const role = viewer?.role as UserRole | undefined;
  const isAdmin = role === 'ADMIN';
  const isPro = role === 'PRO' || role === 'ADMIN';
  const isFree = role === 'FREE';
  const isFoundingRider = viewer?.isFoundingRider ?? false;
  return { role, isAdmin, isPro, isFree, isFoundingRider, loading, error };
}
```

#### 3. RideStatsCard Detailed Sections
Five expandable sections with icons:
1. **RideCountSection** (`FaHashtag`) - Total rides, averages
2. **TrendsSection** (`FaChartLine`) - Requires 2+ rides
3. **HeartRateSection** (`FaHeartbeat`) - Average HR display
4. **LocationSection** (`FaMapMarkerAlt`) - Top locations/trail systems
5. **BikeUsageSection** (`FaBicycle`) - Time per bike

Additional features: `TimeframeDropdown` (YTD + year selection), `BikeFilterDropdown`, `MAX_RIDES_FOR_STATS = 400`

#### 4. EditRideModal
- **Mutation**: `UPDATE_RIDE` GraphQL mutation
- **Fields**: startTime (datetime-local), hours/minutes (split), distance, elevation, averageHr, rideType, bikeId, notes, trailSystem, location
- **Date Handling**: `toLocalInputValue`/`fromLocalInputValue` for timezone conversion

#### 5. Logout Flow
```typescript
// apps/web/src/components/layout/AppShell.tsx
const handleLogout = async () => {
  await fetch(`${import.meta.env.VITE_API_URL}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
    headers: getAuthHeaders(),
  });
  clearCsrfToken();
  // Apollo cache clear follows
};
```

#### 6. Mobile Authentication (API-only)
Four endpoints in `apps/api/src/auth/mobile.route.ts`:
- `POST /auth/mobile/google` - Google ID token auth, returns accessToken + refreshToken
- `POST /auth/mobile/apple` - Placeholder (returns 501)
- `POST /auth/mobile/login` - Email/password auth with WAITLIST blocking
- `POST /auth/mobile/refresh` - Token refresh with JWT verification

#### 7. Rate Limiting System (API-only)
Comprehensive rate limiting in `apps/api/src/lib/rate-limit.ts`:
- **Auth**: `signup` - 5 requests/min/IP
- **Mutations**: 20+ operations defined (addRide: 30/min, logService: 20/min, etc.)
- **Queries**: `unassignedRides` (60/min), `importNotificationState` (30/min)
- **Admin**: activation (10s), createUser (5s), bulkEmail (60s)
- **Fallback**: In-memory rate limiting when Redis unavailable

#### 8. DashboardGreeting Component
- **Time Greeting**: `getTimeOfDayGreeting()` from `greetingMessages.ts`
- **Contextual Insight**: `useGreetingInsight({ stats, bikeHealth, totalHoursAllTime })` returns emoji + message
- **Animation**: Framer Motion fade-in for insight text

#### 9. BikeHealthHero Component
- **Aggregation**: Sums `criticalCount` and `warningCount` across all bikes
- **Quick Actions**: Log Ride (link), Upload GPX (button)
- **Dev Mode**: Test Ride / Long Ride simulation buttons (admin only)
- **States**: Loading skeletons, error display, empty state with "Add your first bike" link

#### 10. AboutAppModal
- **Tabs**: About (description + author), What's New (changelog cards), Roadmap (Now/Next/Later columns)
- **Changelog**: Hardcoded 7 entries from alpha versions (0.1.0-alpha.1 to 0.1.0-alpha.7)
- **Keyboard Navigation**: Arrow keys switch tabs when modal is open
- **Trigger**: `<Button variant="secondary">About this app</Button>`

---

## Appendix: Audit Methodology

### Initial Audit
- **Primary Tools**: Grep, Glob, Read file operations
- **Verification Approach**: Each claim traced to specific file:line where possible
- **Scope Boundary**: Web app (`apps/web`) primary; API (`apps/api`) and shared (`libs/shared`) for cross-references only

### Re-Audit (Missing Coverage Items)
- **Date**: 2026-02-09
- **Scope**: 10 items from Missing Coverage section
- **Files Read Directly**:
  - `apps/web/src/providers/ThemeProvider.tsx`
  - `apps/web/src/hooks/useUserTier.ts`
  - `apps/web/src/components/RideStatsCard/index.tsx`
  - `apps/web/src/components/EditRideModal.tsx`
  - `apps/web/src/components/layout/AppShell.tsx`
  - `apps/api/src/auth/mobile.route.ts`
  - `apps/api/src/lib/rate-limit.ts`
  - `apps/web/src/components/DashboardGreeting/index.tsx`
  - `apps/web/src/components/BikeHealthHero/index.tsx`
  - `apps/web/src/components/AboutAppModal.tsx`
- **Result**: All 10 items confirmed to exist with detailed evidence documented
