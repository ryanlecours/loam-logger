# Mobile Backlog

**Created**: 2026-02-09
**Source**: [Mobile Parity Matrix](./mobile-parity-matrix.md)
**Scope**: MVP features only (44 features, 65% of web parity)

---

## Guardrails

**These constraints apply to ALL tickets. Violations should block PR merge.**

### 1. Gate Order Must Match Web
```
AuthGate → TermsGate → OnboardingGate → Tabs (Main App)
```
- Unauthenticated users → `/login`
- `hasAcceptedCurrentTerms: false` → `/onboarding/terms`
- `onboardingCompleted: false` → `/onboarding/age`
- All flags true → `/(tabs)` (dashboard)

**Enforced in**: MOB-03 (Navigation Structure)

### 2. Use `libs/graphql` Hooks Only
```
✅ DO: Import from @loam/graphql
   import { useMeQuery, useBikesQuery } from '@loam/graphql';

❌ DON'T: Create gql strings in apps/mobile
   const MY_QUERY = gql`query Me { ... }`;  // WRONG
```
- Add new operations to `libs/graphql/src/operations/*.graphql`
- Run `npx nx run graphql:codegen` after adding
- Import generated hooks from `@loam/graphql`

**Enforced in**: MOB-01 (GraphQL Operations Setup)

### 3. CSRF is Web-Only
```
Web:    HTTP-only cookies + x-csrf-token header
Mobile: Bearer tokens via Authorization header
```
- Mobile uses `/auth/mobile/*` endpoints (returns JWT tokens)
- **DO NOT** implement CSRF token handling in mobile
- Store tokens in SecureStore, send as `Authorization: Bearer <token>`

**Enforced in**: MOB-04 (Login Screen)

---

## Table of Contents

1. [Tickets](#tickets)
2. [Recommended Merge Order](#recommended-merge-order)
3. [Definition of Done](#definition-of-done)

---

## Tickets

### Foundation Layer

---

#### MOB-01: GraphQL Operations Setup ✅

**Status**: Complete (2026-02-13)

**Title**: Add shared GraphQL operations for mobile MVP

**Description**:
Update and add GraphQL operations in `libs/graphql/src/operations/` to support mobile MVP features. The existing `me.graphql` is missing fields needed for gating (hasAcceptedCurrentTerms, role). Several operations used by web need to be added as shared operations.

**Dependencies**: None (foundational)

**Files Changed**:
- `libs/graphql/src/operations/me.graphql` (updated - added 8 fields)
- `libs/graphql/src/operations/bikesLight.graphql` (created)
- `libs/graphql/src/operations/bikeNotes.graphql` (created)
- `libs/graphql/src/operations/acceptTerms.graphql` (created)
- `libs/graphql/src/operations/updateUserPreferences.graphql` (created)

**Note - REST-Only Operations**:
The following are NOT GraphQL operations (they use REST endpoints):
- `deleteAccount` → `DELETE /auth/delete-account`
- `searchBikes` → `GET /api/spokes/search?q=<query>`
- `completeOnboarding` → `POST /onboarding/complete`

Mobile will call these via fetch, not Apollo.

**Acceptance Criteria**:
- [x] `me.graphql` includes: `hasAcceptedCurrentTerms`, `role`, `isFoundingRider`, `hoursDisplayPreference`, `predictionMode`, `createdAt`
- [x] `bikesLight.graphql` matches web's `BIKES_LIGHT` query structure
- [x] All new operations compile without TypeScript errors
- [x] `npx nx run graphql:codegen` generates hooks successfully
- [x] Generated types export from `libs/graphql/src/index.ts`
- [x] **GUARDRAIL**: No `.graphql` files created in `apps/mobile/` (all in `libs/graphql/`)

**Manual Test Steps**:
1. ✅ Run `npx nx run graphql:codegen` - SUCCESS
2. ✅ Verify no errors in console - PASSED
3. ✅ Check `libs/graphql/src/generated/index.ts` contains new operations - VERIFIED
4. ✅ Import a new hook in a test file to verify types work - VERIFIED
5. ✅ Verify `find apps/mobile -name "*.graphql"` returns no results - PASSED

---

#### MOB-02: Enhanced Auth with ME Query Gating ✅

**Status**: Complete (2026-02-13)

**Title**: Integrate ME query for auth state and gating flags

**Description**:
Enhance the existing `useAuth` hook to fetch full user data via ME query after token-based login. The auth context should expose `hasAcceptedCurrentTerms`, `onboardingCompleted`, and `role` for navigation gating.

**Dependencies**: MOB-01

**Files Changed**:
- `apps/mobile/src/lib/auth.ts` - Expanded User type with gating fields, added LoginUser type for stored minimal user, added token refresh callback
- `apps/mobile/src/hooks/useViewer.ts` - Created ME query wrapper hook
- `apps/mobile/src/hooks/useAuth.tsx` - Complete rewrite with ME integration, gating flags, Apollo cache clearing on logout
- `apps/mobile/app/(auth)/login.tsx` - Updated to use `setAuthenticated()` instead of `setUser()`
- `apps/mobile/app/(auth)/signup.tsx` - Updated to use `setAuthenticated()` instead of `setUser()`

**How it Works**:
1. On mount, `useAuth` checks SecureStore for access token
2. If token exists, sets `isAuthenticated: true` which enables ME query
3. ME query fetches full user data with all gating flags
4. `viewer` response is mapped to `User` type and set in state
5. Gating flags derived: `hasAcceptedCurrentTerms`, `onboardingCompleted`, `role`, `mustChangePassword`
6. Token refresh callback in `auth.ts` notifies `useAuth` to refetch ME
7. Logout clears SecureStore + Apollo cache via `client.clearStore()`

**Acceptance Criteria**:
- [x] After successful login, ME query is executed to fetch full user data
- [x] Auth context exposes: `user`, `loading`, `hasAcceptedCurrentTerms`, `onboardingCompleted`, `role`
- [x] Token refresh triggers ME query re-fetch
- [x] Logout clears both SecureStore tokens and Apollo cache
- [x] Auth state persists across app restart (token in SecureStore, user re-fetched)

**Manual Test Steps**:
1. ✅ Login with valid credentials
2. ✅ Verify `console.log` shows full user data with `hasAcceptedCurrentTerms`
3. ✅ Kill and restart app
4. ✅ Verify user is still logged in (auto-refresh works)
5. ✅ Logout and verify redirected to login screen

---

#### MOB-03: Navigation Structure with Protected Routes

**Title**: Implement route protection (Auth, Terms, Onboarding gates)

**Description**:
Update root layout to implement the protection order matching web: **AuthGate → TermsGate → OnboardingGate → Main App**. This gate order is a guardrail and must not deviate. Users without tokens go to login. Logged-in users who haven't accepted terms go to terms screen. Users who haven't completed onboarding go to onboarding flow.

**Dependencies**: MOB-02

**Files Expected to Change**:
- `apps/mobile/app/_layout.tsx` (update)
- `apps/mobile/app/(onboarding)/_layout.tsx` (create)
- `apps/mobile/app/(onboarding)/terms.tsx` (create placeholder)
- `apps/mobile/app/(onboarding)/age.tsx` (create placeholder)
- `apps/mobile/app/(onboarding)/bike.tsx` (create placeholder)
- `apps/mobile/app/closed-beta.tsx` (create placeholder)
- `apps/mobile/app/waitlist.tsx` (create placeholder)

**Acceptance Criteria**:
- [ ] Unauthenticated users are redirected to `/(auth)/login`
- [ ] Users with `hasAcceptedCurrentTerms: false` redirect to `/(onboarding)/terms`
- [ ] Users with `onboardingCompleted: false` redirect to `/(onboarding)/age` (after terms)
- [ ] Users with both flags true see `/(tabs)` (main app)
- [ ] Navigation prevents back-navigation to completed gates
- [ ] **GUARDRAIL**: Gate order is Auth → Terms → Onboarding → Tabs (matches web exactly)

**Manual Test Steps**:
1. Clear app data, launch app → should see login
2. Login with user who hasn't accepted terms → should see terms screen
3. Accept terms (placeholder) → should see age screen
4. Complete onboarding (placeholder) → should see main tabs
5. Restart app → should go directly to main tabs
6. Verify gate order matches: can't reach onboarding without auth, can't reach tabs without terms+onboarding

---

### Auth Flow

---

#### MOB-04: Login Screen Polish

**Title**: Complete login screen with Google Sign-In and Email/Password

**Description**:
Polish the existing login screen to support Google Sign-In (native SDK) and email/password login. Handle error states including CLOSED_BETA and ALREADY_ON_WAITLIST responses. Redirect to appropriate screens based on response.

**Dependencies**: MOB-03

**Files Expected to Change**:
- `apps/mobile/app/(auth)/login.tsx` (update)
- `apps/mobile/src/components/GoogleSignInButton.tsx` (create)
- `apps/mobile/src/components/EmailPasswordForm.tsx` (create)
- `apps/mobile/package.json` (add `@react-native-google-signin/google-signin`)
- `apps/mobile/app.json` (add Google Sign-In config)

**Acceptance Criteria**:
- [ ] Google Sign-In button initiates native OAuth flow
- [ ] Email/password form with validation feedback
- [ ] Loading state during authentication
- [ ] Error messages display for invalid credentials
- [ ] CLOSED_BETA response redirects to `/closed-beta`
- [ ] ALREADY_ON_WAITLIST response redirects to `/waitlist`
- [ ] OAuth-only account error displays appropriate message (AUTH-10)
- [ ] Successful login stores tokens and navigates based on user state
- [ ] **GUARDRAIL**: Uses Bearer token auth (no CSRF). Tokens stored in SecureStore, sent as `Authorization: Bearer <token>`

**Manual Test Steps**:
1. Tap Google Sign-In → complete OAuth flow → verify login
2. Enter invalid email/password → verify error message
3. Enter valid email/password → verify login
4. Test with new Google account → verify CLOSED_BETA redirect
5. Test with waitlist email → verify ALREADY_ON_WAITLIST redirect

---

#### MOB-05: Signup Screen with Password Validation

**Title**: Implement signup screen with shared password validation

**Description**:
Create signup screen that uses `validatePassword()` from `@loam/shared` for real-time password requirements feedback. Handle waitlist flow for closed beta.

**Dependencies**: MOB-04

**Files Expected to Change**:
- `apps/mobile/app/(auth)/signup.tsx` (update)
- `apps/mobile/src/components/PasswordRequirements.tsx` (create)
- `apps/mobile/src/lib/auth.ts` (add signup function)

**Acceptance Criteria**:
- [ ] Email input with validation
- [ ] Password input with real-time requirements checklist
- [ ] Requirements from `@loam/shared/password.ts`: 8+ chars, upper, lower, number, special
- [ ] Confirm password field with match validation
- [ ] Submit creates WAITLIST user and redirects to `/waitlist`
- [ ] Error handling for existing email

**Manual Test Steps**:
1. Enter email and weak password → verify requirements show as unmet
2. Enter strong password → verify all requirements show as met
3. Submit with mismatched passwords → verify error
4. Submit valid form → verify redirect to waitlist screen
5. Try same email again → verify "already exists" error

---

#### MOB-06: Closed Beta and Waitlist Screens

**Title**: Create informational screens for closed beta flow

**Description**:
Create static informational screens for users who encounter closed beta or are on the waitlist. Include clear messaging and option to return to login.

**Dependencies**: MOB-04

**Files Expected to Change**:
- `apps/mobile/app/closed-beta.tsx` (implement)
- `apps/mobile/app/waitlist.tsx` (implement)

**Acceptance Criteria**:
- [ ] Closed beta screen explains beta status with friendly messaging
- [ ] Waitlist screen confirms user is on waitlist
- [ ] Both screens have "Back to Login" button
- [ ] Screens match web styling/tone

**Manual Test Steps**:
1. Trigger CLOSED_BETA flow → verify screen displays
2. Tap "Back to Login" → verify navigation works
3. Trigger ALREADY_ON_WAITLIST flow → verify screen displays
4. Tap "Back to Login" → verify navigation works

---

### Onboarding

---

#### MOB-07: Terms Acceptance Screen

**Title**: Implement terms acceptance with mutation

**Description**:
Create terms acceptance screen that displays terms content (from `@loam/shared/legal/terms.ts`) and calls `acceptTerms` mutation. Uses `CURRENT_TERMS_VERSION` constant.

**Dependencies**: MOB-03, MOB-01

**Files Expected to Change**:
- `apps/mobile/app/(onboarding)/terms.tsx` (implement)
- `apps/mobile/src/components/TermsContent.tsx` (create)

**Acceptance Criteria**:
- [ ] Displays terms content in scrollable view
- [ ] "I Accept" button at bottom
- [ ] Button disabled until scrolled to bottom (optional UX)
- [ ] Calls `acceptTerms` mutation with `{ version: CURRENT_TERMS_VERSION }`
- [ ] On success, navigates to age screen
- [ ] Updates local auth state (`hasAcceptedCurrentTerms: true`)

**Manual Test Steps**:
1. Login as user without terms accepted → land on terms screen
2. Scroll through terms content
3. Tap "I Accept" → verify mutation fires
4. Verify navigation to age screen
5. Restart app → verify terms screen is skipped

---

#### MOB-08: Age Input Screen

**Title**: Implement age input with validation

**Description**:
Create age input screen with validation (16-115 years). Store age via mutation and navigate to bike search.

**Dependencies**: MOB-07

**Files Expected to Change**:
- `apps/mobile/app/(onboarding)/age.tsx` (implement)

**Acceptance Criteria**:
- [ ] Numeric input for age
- [ ] Validation: must be 16-115 inclusive
- [ ] Error message for invalid age
- [ ] "Continue" button calls update mutation
- [ ] Navigates to bike search on success

**Manual Test Steps**:
1. Enter age 15 → verify error "Must be at least 16"
2. Enter age 116 → verify error "Must be 115 or under"
3. Enter age 25 → verify no error
4. Tap Continue → verify navigation to bike screen

---

#### MOB-09: Bike Search and Manual Entry

**Title**: Implement 99Spokes bike search with manual fallback

**Description**:
Create bike selection screen with 99Spokes search autocomplete. Include toggle for manual entry when bike not found. Validates required fields (manufacturer, model).

**Dependencies**: MOB-08, MOB-01

**Files Expected to Change**:
- `apps/mobile/app/(onboarding)/bike.tsx` (implement)
- `apps/mobile/src/components/BikeSearch.tsx` (create)
- `apps/mobile/src/components/ManualBikeForm.tsx` (create)
- `apps/mobile/src/utils/bikeImageValidation.ts` (create - reuse web's `isValidImageUrl`)

**Acceptance Criteria**:
- [ ] Search input with debounced autocomplete (300ms)
- [ ] Results show bike name, year, thumbnail
- [ ] Selecting a result auto-fills form fields
- [ ] "Enter manually" link toggles to manual form
- [ ] Manual form: year (optional), manufacturer (required), model (required)
- [ ] Image URLs validated with `isValidImageUrl()` before display (ONB-11)
- [ ] "Add Bike" calls `addBike` mutation
- [ ] Navigates to completion on success

**Manual Test Steps**:
1. Type "Santa Cruz" → verify autocomplete results
2. Select a bike → verify fields populate
3. Tap "Enter manually" → verify form appears
4. Submit without manufacturer → verify error
5. Submit valid bike → verify creation and navigation

---

#### MOB-10: Onboarding Completion

**Title**: Complete onboarding and navigate to main app

**Description**:
After bike is added, mark onboarding as complete and navigate to dashboard. Simple confirmation screen with "Get Started" button.

**Dependencies**: MOB-09

**Files Expected to Change**:
- `apps/mobile/app/(onboarding)/complete.tsx` (create)

**Acceptance Criteria**:
- [ ] Shows success message with bike name
- [ ] "Get Started" button calls `completeOnboarding` mutation
- [ ] Updates local auth state (`onboardingCompleted: true`)
- [ ] Navigates to `/(tabs)` (dashboard)
- [ ] Back navigation disabled (can't go back to onboarding)

**Manual Test Steps**:
1. Complete bike selection → land on completion screen
2. Verify bike name displayed
3. Tap "Get Started" → verify navigation to dashboard
4. Swipe back → verify can't return to onboarding

---

### Dashboard

---

#### MOB-11: Dashboard Greeting and Bike Health Hero

**Title**: Implement dashboard with greeting and bike health cards

**Description**:
Create main dashboard screen with time-of-day greeting (reuse logic from web) and bike health hero section showing priority bike and health status.

**Dependencies**: MOB-10, MOB-01

**Files Expected to Change**:
- `apps/mobile/app/(tabs)/index.tsx` (update - rename to dashboard)
- `apps/mobile/src/components/DashboardGreeting.tsx` (create)
- `apps/mobile/src/components/BikeHealthCard.tsx` (create)
- `apps/mobile/src/hooks/usePriorityBike.ts` (create - port from web)
- `apps/mobile/src/utils/greetingMessages.ts` (create - port from web)

**Acceptance Criteria**:
- [ ] Greeting shows "Good morning/afternoon/evening, {firstName}"
- [ ] Contextual insight message based on bike health (port `useGreetingInsight`)
- [ ] Priority bike card shows: name, image, overall status, component counts
- [ ] Status indicators: OVERDUE (red), DUE_NOW (orange), DUE_SOON (yellow), ALL_GOOD (green)
- [ ] Tap bike card navigates to bike detail
- [ ] Loading skeleton while data fetches

**Manual Test Steps**:
1. Login and complete onboarding → land on dashboard
2. Verify greeting matches time of day
3. Verify bike card shows correct status colors
4. Tap bike card → verify navigation to bike detail
5. Pull to refresh → verify data reloads

---

#### MOB-12: Recent Rides List

**Title**: Add recent rides section to dashboard

**Description**:
Add scrollable list of recent rides (limit 20) below bike health section. Each ride shows date, duration, distance, and assigned bike.

**Dependencies**: MOB-11

**Files Expected to Change**:
- `apps/mobile/app/(tabs)/index.tsx` (update)
- `apps/mobile/src/components/RecentRidesList.tsx` (create)
- `apps/mobile/src/components/RideCard.tsx` (create)

**Acceptance Criteria**:
- [ ] Fetches last 20 rides (`take: 20`)
- [ ] Each ride shows: date, duration (hours:minutes), distance (miles), bike name
- [ ] Empty state: "No rides logged yet" with hint about device sync
- [ ] Tap ride card navigates to rides tab
- [ ] Uses `cache-and-network` fetch policy

**Manual Test Steps**:
1. View dashboard with rides → verify list displays
2. Verify ride details are correct
3. Tap a ride → verify navigation to rides tab
4. View dashboard with no rides → verify empty state message

---

#### MOB-13: Two-Phase Bike Loading

**Title**: Implement two-phase loading for performance

**Description**:
Optimize dashboard loading by fetching `BIKES_LIGHT` first (fast), then `BIKES` with predictions in background. Shows skeleton/spinner only for predictions.

**Dependencies**: MOB-11, MOB-01

**Files Expected to Change**:
- `apps/mobile/app/(tabs)/index.tsx` (update)
- `apps/mobile/src/hooks/useBikesWithPredictions.ts` (create)

**Acceptance Criteria**:
- [ ] Initial render uses `BIKES_LIGHT` (fast)
- [ ] Bike cards render immediately with basic data
- [ ] `BIKES` query runs in background (`skip` until light data loaded)
- [ ] Prediction data appears without full re-render
- [ ] Status badges update smoothly when predictions arrive

**Manual Test Steps**:
1. Force slow network (throttle in dev tools)
2. Navigate to dashboard → verify bike cards appear quickly
3. Verify status indicators update after predictions load
4. Measure time to first render vs time to full data

---

### Rides

---

#### MOB-14: Rides List with Date Filtering

**Title**: Implement rides tab with date range filtering

**Description**:
Create rides list screen with filter chips for date ranges (30d, 3mo, 6mo, 1yr) and year picker. Uses existing `RIDES` query with filter variables.

**Dependencies**: MOB-12

**Files Expected to Change**:
- `apps/mobile/app/(tabs)/rides.tsx` (create or update from index.tsx)
- `apps/mobile/src/components/DateRangeFilter.tsx` (create)
- `apps/mobile/src/components/RidesList.tsx` (create)
- `apps/mobile/src/utils/dateRangeFilters.ts` (create - port from web)

**Acceptance Criteria**:
- [ ] Filter chips: Last 30 days, 3 months, 6 months, 1 year
- [ ] Year dropdown for historical years (back to 2020)
- [ ] List updates when filter changes
- [ ] Each ride card shows: date, duration, distance, elevation, bike
- [ ] Empty state for filtered results: "No rides in this period"
- [ ] Pull to refresh

**Manual Test Steps**:
1. View rides tab → verify default filter (30 days)
2. Tap "3 months" → verify list updates
3. Select year 2024 → verify historical rides load
4. Filter with no results → verify empty state

---

#### MOB-15: Ride Stats Card

**Title**: Implement ride stats card with expandable sections

**Description**:
Add stats summary card above rides list showing aggregated statistics for the selected date range. Include 5 expandable sections matching web.

**Dependencies**: MOB-14

**Files Expected to Change**:
- `apps/mobile/app/(tabs)/rides.tsx` (update)
- `apps/mobile/src/components/RideStatsCard.tsx` (create)
- `apps/mobile/src/components/stats/RideCountSection.tsx` (create)
- `apps/mobile/src/components/stats/TrendsSection.tsx` (create)
- `apps/mobile/src/components/stats/HeartRateSection.tsx` (create)
- `apps/mobile/src/components/stats/LocationSection.tsx` (create)
- `apps/mobile/src/components/stats/BikeUsageSection.tsx` (create)
- `apps/mobile/src/hooks/useRideStats.ts` (create - port from web)

**Acceptance Criteria**:
- [ ] Summary shows: total distance, elevation, hours
- [ ] 5 expandable/collapsible sections:
  - Ride Count & Averages
  - Trends & Streaks (requires 2+ rides)
  - Heart Rate (if data available)
  - Locations (if data available)
  - Bike Usage
- [ ] Sections show "Not enough data" when applicable
- [ ] Stats update when date filter changes

**Manual Test Steps**:
1. View rides with data → verify stats display
2. Tap each section header → verify expand/collapse
3. Change date filter → verify stats update
4. View with 1 ride → verify "Need more rides" on trends

---

### Gear

---

#### MOB-16: Bikes List (Gear Tab)

**Title**: Implement gear tab with bikes list

**Description**:
Create gear tab showing list of user's bikes with health status indicators. Each card is tappable to navigate to bike detail.

**Dependencies**: MOB-11

**Files Expected to Change**:
- `apps/mobile/app/(tabs)/gear.tsx` (update)
- `apps/mobile/src/components/BikeListCard.tsx` (create)

**Acceptance Criteria**:
- [ ] Lists all user bikes with: name, image, status badge
- [ ] Status badge shows overall health (OVERDUE/DUE_NOW/DUE_SOON/ALL_GOOD)
- [ ] Component counts: "2 due now, 1 due soon"
- [ ] Tap card navigates to `/gear/[bikeId]`
- [ ] Empty state: "No bikes yet" with hint to add via web
- [ ] Pull to refresh

**Manual Test Steps**:
1. View gear tab → verify bikes list
2. Verify status badges match dashboard
3. Tap a bike → verify navigation to detail
4. Pull to refresh → verify data reloads

---

#### MOB-17: Bike Detail (Read-Only)

**Title**: Implement bike detail screen with components and notes

**Description**:
Create bike detail screen showing bike info, components sorted by urgency, and notes section (read-only). This is MVP read-only view; editing is Phase 2.

**Dependencies**: MOB-16, MOB-01

**Files Expected to Change**:
- `apps/mobile/app/gear/[bikeId].tsx` (create)
- `apps/mobile/src/components/BikeDetailHeader.tsx` (create)
- `apps/mobile/src/components/ComponentList.tsx` (create)
- `apps/mobile/src/components/ComponentRow.tsx` (create)
- `apps/mobile/src/components/BikeNotesSection.tsx` (create)

**Acceptance Criteria**:
- [ ] Header: bike image, name, specs (travel, category)
- [ ] Components sorted by urgency: OVERDUE > DUE_NOW > DUE_SOON > ALL_GOOD (DETAIL-01)
- [ ] Each component shows: type, brand/model, status, hours remaining
- [ ] Paired components show location suffix (Front/Rear)
- [ ] Notes section with paginated list (read-only)
- [ ] Back navigation to gear list

**Manual Test Steps**:
1. Navigate to bike detail → verify header displays
2. Verify components sorted by urgency (overdue first)
3. Verify paired components show "Front"/"Rear"
4. Scroll to notes → verify notes display
5. Tap back → verify return to gear list

---

### Settings

---

#### MOB-18: Settings Screen

**Title**: Implement settings screen with preferences

**Description**:
Create settings screen with hours display preference (Total/Remaining), account info display, and logout button. Include unsaved changes indicator.

**Dependencies**: MOB-11, MOB-01

**Files Expected to Change**:
- `apps/mobile/app/(tabs)/settings.tsx` (update)
- `apps/mobile/src/components/HoursDisplayPicker.tsx` (create)
- `apps/mobile/src/components/AccountInfo.tsx` (create)

**Acceptance Criteria**:
- [ ] Account section: name, email (read-only)
- [ ] Hours Display preference: Total vs Remaining radio buttons
- [ ] Save button calls `updateUserPreferences` mutation
- [ ] Unsaved changes indicator (amber text)
- [ ] Success toast on save (auto-dismiss 3s)
- [ ] Logout button with confirmation

**Manual Test Steps**:
1. View settings → verify account info displays
2. Change hours preference → verify unsaved indicator
3. Tap Save → verify success message
4. Tap Logout → verify confirmation dialog
5. Confirm logout → verify return to login screen

---

#### MOB-19: Delete Account Flow

**Title**: Implement delete account with confirmation

**Description**:
Add delete account option in settings with multi-step confirmation. Required for app store compliance. Calls `deleteAccount` mutation and clears all local data.

**Dependencies**: MOB-18

**Files Expected to Change**:
- `apps/mobile/app/(tabs)/settings.tsx` (update)
- `apps/mobile/src/components/DeleteAccountModal.tsx` (create)

**Acceptance Criteria**:
- [ ] "Delete Account" button in danger zone section
- [ ] First tap shows warning modal with consequences
- [ ] Must type "DELETE" to confirm
- [ ] Calls `deleteAccount` mutation
- [ ] On success: clears SecureStore, clears Apollo cache
- [ ] Navigates to login screen
- [ ] Cannot undo - permanent action

**Manual Test Steps**:
1. Tap Delete Account → verify warning modal
2. Try to confirm without typing DELETE → verify button disabled
3. Type DELETE → verify button enables
4. Confirm → verify account deleted
5. Verify returned to login screen
6. Try to login with deleted account → verify fails

---

## Recommended Merge Order

### Topological Sort

```
Phase 1: Foundation
├── MOB-01 (GraphQL Operations)
├── MOB-02 (ME Query Gating) ← depends on MOB-01
└── MOB-03 (Navigation) ← depends on MOB-02

Phase 2: Auth Flow
├── MOB-04 (Login) ← depends on MOB-03
├── MOB-05 (Signup) ← depends on MOB-04
└── MOB-06 (Beta Screens) ← depends on MOB-04

Phase 3: Onboarding
├── MOB-07 (Terms) ← depends on MOB-03, MOB-01
├── MOB-08 (Age) ← depends on MOB-07
├── MOB-09 (Bike Search) ← depends on MOB-08, MOB-01
└── MOB-10 (Complete) ← depends on MOB-09

Phase 4: Main App
├── MOB-11 (Dashboard Hero) ← depends on MOB-10, MOB-01
├── MOB-12 (Recent Rides) ← depends on MOB-11
├── MOB-13 (Two-Phase Load) ← depends on MOB-11
├── MOB-14 (Rides List) ← depends on MOB-12
├── MOB-15 (Stats Card) ← depends on MOB-14
├── MOB-16 (Bikes List) ← depends on MOB-11
├── MOB-17 (Bike Detail) ← depends on MOB-16, MOB-01
├── MOB-18 (Settings) ← depends on MOB-11, MOB-01
└── MOB-19 (Delete Account) ← depends on MOB-18
```

### Recommended Order

| Order | Ticket | Effort | Blocking |
|-------|--------|--------|----------|
| 1 | MOB-01 | 1 day | All other tickets |
| 2 | MOB-02 | 1 day | MOB-03+ |
| 3 | MOB-03 | 1 day | MOB-04+ |
| 4 | MOB-04 | 1.5 days | MOB-05, MOB-06 |
| 5 | MOB-05 | 1 day | - |
| 6 | MOB-06 | 0.5 days | - |
| 7 | MOB-07 | 1 day | MOB-08+ |
| 8 | MOB-08 | 0.5 days | MOB-09 |
| 9 | MOB-09 | 1.5 days | MOB-10 |
| 10 | MOB-10 | 0.5 days | MOB-11+ |
| 11 | MOB-11 | 1.5 days | MOB-12, MOB-13, MOB-16, MOB-18 |
| 12 | MOB-12 | 1 day | MOB-14 |
| 13 | MOB-13 | 1 day | - |
| 14 | MOB-14 | 1.5 days | MOB-15 |
| 15 | MOB-15 | 1.5 days | - |
| 16 | MOB-16 | 1 day | MOB-17 |
| 17 | MOB-17 | 1.5 days | - |
| 18 | MOB-18 | 1 day | MOB-19 |
| 19 | MOB-19 | 1 day | - |

**Total Estimated Effort**: ~20 days

**Critical Path**: MOB-01 → MOB-02 → MOB-03 → MOB-04 → MOB-07 → MOB-08 → MOB-09 → MOB-10 → MOB-11

---

## Definition of Done

### Per-Ticket Checklist

- [ ] Feature works on iOS simulator (latest iOS)
- [ ] Feature works on Android emulator (API 33+)
- [ ] TypeScript compiles without errors (`npx tsc --noEmit`)
- [ ] ESLint passes (`npx nx lint mobile`)
- [ ] All acceptance criteria verified
- [ ] Manual test steps completed and passing
- [ ] No console errors or warnings
- [ ] Code follows existing patterns in codebase
- [ ] **GUARDRAILS VERIFIED**:
  - [ ] No `.graphql` files in `apps/mobile/` (use `libs/graphql/` only)
  - [ ] No CSRF token handling (Bearer tokens only)
  - [ ] Gate order matches web (Auth → Terms → Onboarding → Tabs)

### Mobile MVP Complete Checklist

- [ ] All 19 tickets merged to main
- [ ] E2E happy path works:
  - Login → Onboarding → Dashboard → Rides → Gear → Settings
- [ ] Logout clears state and returns to login
- [ ] Delete account works (app store requirement)
- [ ] All 44 MVP features from parity matrix implemented
- [ ] Shared lib imports work:
  - `@loam/shared` (componentCatalog, password, terms)
  - `@loam/graphql` (generated hooks)
- [ ] No crashes on iOS simulator
- [ ] No crashes on Android emulator
- [ ] App launches from cold start in < 3 seconds
- [ ] Network errors show user-friendly messages
- [ ] Offline state handled gracefully (show cached data)

### Pre-Release Checklist

- [ ] Tested on physical iOS device
- [ ] Tested on physical Android device
- [ ] App icons and splash screen configured
- [ ] Bundle identifiers set correctly
- [ ] API URL configured for production
- [ ] No hardcoded test data
- [ ] Sentry/error tracking configured
- [ ] App store metadata prepared
