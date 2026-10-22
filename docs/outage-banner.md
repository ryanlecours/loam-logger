# Service outage banner

A flag-driven notice that tells riders Loam Logger is down and that someone is on it. It shows on every route of the web app (bottom strip) and every screen of the mobile app (top strip, under the status bar).

The switch is a **PostHog feature flag**, not anything served by our API, because the banner exists for the moments when the API is unreachable. Flipping it needs no deploy.

- Flag: `service-outage-banner` (tag `ops`) in PostHog project 390664
- Direct link: https://us.posthog.com/project/390664/feature-flags/983683

## Turning it on

1. Open the flag and set it to **Enabled**. It is already rolled out to 100% of users with no conditions; leave that alone.
2. Optional: edit the payload on the `true` match to change the copy:

   ```json
   { "message": "Loam Logger is experiencing a service outage. I am aware of the issue and working on restoring functionality as quickly as possible." }
   ```

   An empty or missing payload falls back to that same default copy in both apps.
3. Check it: load https://loamlogger.app in a private window. The strip should be there within a few seconds of the page loading.

## Turning it off

Set the flag to **Disabled**. Do not delete it; the apps read it by key.

## What to expect

- **Web** reads flags on every page load and again whenever the tab comes back into view. A rider sitting on an open tab sees the change on their next load or tab switch.
- **Mobile** reads flags at launch and again whenever the app returns to the foreground. The banner needs a build that includes it (first shipped in the release after 1.3.5); older builds never show it.
- **Riders who opted out of analytics still see it.** Both SDKs stop sending events on opt-out; they still fetch flags.
- **Dismissal is per tab session on web** and keyed to the message, so changing the copy (a new ETA, say) brings the strip back for riders who dismissed the old one. Mobile has no dismiss.
- **Dev and preview builds never show it.** PostHog is only initialized in production builds with a key.
- **If PostHog itself is down**, there is no banner. It is independent of Railway and Vercel, which is the point, but it is not independent of PostHog.
