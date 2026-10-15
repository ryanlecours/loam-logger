# Account deletion runbook

How riders delete their accounts, and what to do when one writes in instead. The public page at https://loamlogger.app/delete-account is listed on the Google Play store listing, so Play reviewers may test any of these paths, including writing to the contact address on that page.

## The self-serve paths

All three run the same teardown, `deleteUserAccount` in `apps/api/src/services/account-deletion.service.ts`. It cancels any Stripe subscription first, then removes the rider's data and revokes Strava and Garmin access.

1. **App:** Settings tab, then Delete Account.
2. **Website:** Settings, then Danger Zone, then Delete Account.
3. **Emailed link:** the form on `/delete-account` sends a confirmation link to the account's address. The rider opens it and presses Delete my account. The link expires after 60 minutes.

App Store and Google Play subscriptions can't be cancelled by us. The rider has to cancel those in the store.

## When a rider emails asking to be deleted

The page says: "No longer have access to that inbox? Email us and we'll help." Requests can also arrive as replies to other emails, or through the Support form.

**Never delete on the strength of an email alone.** The From address of an email can be forged, so "it came from the account's address" proves nothing. Ownership is proven by receiving mail at that address (the emailed link) or by signing in.

1. **They still have the inbox:** reply with the link to https://loamlogger.app/delete-account#by-email and ask them to use the form. The confirmation email is the identity check, and the account is deleted once they confirm. Nothing else is needed from us.
2. **They can sign in another way** (Google or Apple sign-in on the account, or a password they still know): ask them to sign in and delete from Settings, in the app or on the website.
3. **They've lost access to the inbox and can't sign in:** we can't verify they own the account. Suggest recovering the inbox with their email provider, then using the form. Do not delete the account for them. *(Policy to confirm: whether any other proof is acceptable, such as a request from a new address naming the account plus details only the owner would know.)*

Aim to answer within a month of the request, the limit GDPR sets for erasure requests from riders in the EU and UK.

## Deleting from the admin panel

Admin, then Users, then delete. Use it only once one of the checks above has proven ownership, or for your own test accounts.

It runs the same `deleteUserAccount` as the self-serve paths. If it answers "Couldn't cancel this user's Stripe subscription", nothing was deleted: wait a few minutes and try again, or check the subscription in the Stripe dashboard.

## What deletion removes and keeps

The public page is the source of truth for riders: https://loamlogger.app/delete-account#what-is-deleted. Keep it in step with `deleteUserAccount` and with the privacy policy's Retention & Deletion section. In short:

- **Removed at once:** profile and sign-in methods, bikes, components, service history, notes, rides with GPS tracks and weather, provider connections, share links, notification preferences, and the Stripe customer.
- **Kept for a time:** error reports in Sentry (up to 90 days) and analytics in PostHog (up to 12 months).
- **Kept by others:** payment records held by Google Play, the App Store and Stripe under their own policies.
