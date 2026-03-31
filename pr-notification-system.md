# Push Notification System

## Summary

Adds a fully configurable push notification system to Loam Logger, spanning both the API backend and the mobile app. Users can control all notification preferences from the Settings tab, with per-bike granularity for service reminders.

## What it does

**Ride Sync Notifications** - Users are notified when rides sync from Strava, Garmin, or WHOOP. Displays duration, distance (in the user's preferred unit), and bike name. Enabled by default, toggleable from settings.

**Service Due Notifications** - After a ride syncs, the system checks if any components on the associated bike are approaching service. Users configure per-bike how they want to be reminded:
- **Rides before** (default): "Notify me X rides before service is due" (default: 3)
- **Hours before**: "Notify me at X hours before service is due"
- **At service**: "Notify me only when service is due"

Notifications are deduplicated per component — once notified about a component, it won't re-fire until the component is serviced and becomes due again.

## Backend Changes

### Database
- New `BikeNotificationPreference` model (per-bike notification settings)
- New `NotificationLog` model (deduplication tracking)
- New `ServiceNotificationMode` enum (`RIDES_BEFORE`, `HOURS_BEFORE`, `AT_SERVICE`)
- Added `expoPushToken` and `notifyOnRideUpload` fields to `User`
- Migration includes backfill for existing bikes with default preferences

### GraphQL
- Extended `UpdateUserPreferencesInput` with `expoPushToken` and `notifyOnRideUpload`
- New `BikeNotificationPreference` type on `Bike`
- New `updateBikeNotificationPreference` mutation
- `notifyOnRideUpload` field on `User` type

### Notification Service (`notification.service.ts`)
- `notifyRideUploaded()` — formats and sends ride sync notifications via Expo push service
- `checkAndNotifyServiceDue()` — evaluates component predictions against user's configured mode/threshold, deduplicates, and sends
- `clearServiceNotificationLogs()` — resets dedup state when a component is serviced

### Triggers
- **Sync worker** (`sync.worker.ts`): Fire-and-forget notifications after Strava, Garmin, and WHOOP ride upserts (new rides only)
- **Strava webhook** (`webhooks.strava.ts`): Same for direct webhook ride creation path
- **Service logging** (`resolvers.ts`): Clears notification dedup logs in `logComponentService` and `logService`

### Dependencies
- `expo-server-sdk` — sends push notifications via Expo's push service (handles APNs/FCM routing)

## Mobile Changes

### Infrastructure
- `expo-notifications` + `expo-device` installed, plugin added to `app.json`
- `src/lib/notifications.ts` — permission request, token registration, foreground handler, notification tap routing
- `src/hooks/useNotifications.ts` — hook following existing `useDistanceUnit` pattern
- Root layout (`_layout.tsx`) — configures foreground display, registers push token on auth, handles notification tap navigation

### Settings UI
- **Notification Preferences** section added to Settings tab (between Preferences and Logout)
  - Push Notifications toggle (triggers OS permission prompt, shows "Enable in system settings" if denied)
  - Ride Sync Alerts toggle
  - Service Reminders row navigates to per-bike screen

- **Service Reminders screen** (`app/settings/service-notifications.tsx`)
  - Lists each active bike with:
    - Enable/disable toggle
    - Reminder timing segmented control (Rides / Hours / At service)
    - Threshold input (number of rides or hours)

### GraphQL Operations
- `me.graphql` — added `notifyOnRideUpload`
- `updateUserPreferences.graphql` — added `notifyOnRideUpload` to response
- `gear.graphql` — added `BikeNotificationPreferenceFields` fragment, `notificationPreference` on `BikeFields`, `UpdateBikeNotificationPreference` mutation

## Tests

- **20 unit tests** for `notification.service.ts` covering all three exported functions, edge cases (invalid token, push failure, dedup, multi-component summary, all three notification modes)
- **13 resolver tests** for `updateUserPreferences` (push token, ride upload toggle, validation), `updateBikeNotificationPreference` (ownership, mode/threshold validation, upsert), and dedup reset on service

## Pre-deployment steps

1. Run the Prisma migration: `cd apps/api && npx prisma migrate deploy`
2. Rebuild the mobile dev client (native dependency added): `cd loam-logger-mobile && eas build --profile development`

## Test plan

- [ ] Apply migration, verify `BikeNotificationPreference` rows backfilled for existing bikes
- [ ] Toggle push notifications on in settings, confirm OS permission prompt and token sent to backend
- [ ] Toggle ride sync alerts off, sync a ride, confirm no notification received
- [ ] Toggle ride sync alerts on, sync a ride from Strava/Garmin, confirm push notification with correct distance unit and bike name
- [ ] Tap a ride notification, confirm navigation to rides tab
- [ ] Configure a bike with "Rides before" = 3, sync rides until a component hits 3 remaining, confirm service notification
- [ ] Confirm service notification does NOT re-fire on subsequent ride syncs (dedup)
- [ ] Service the component, sync rides until threshold again, confirm notification fires again (dedup reset)
- [ ] Switch a bike to "Hours before" mode with threshold = 10, verify correct trigger behavior
- [ ] Switch a bike to "At service" mode, verify only DUE_NOW/OVERDUE triggers notification
- [ ] Disable service notifications for one bike, confirm no notifications for that bike while others still fire
- [ ] Verify permission denied flow shows "Enable in system settings" link
- [ ] Run `npx jest --no-coverage` — all tests pass
