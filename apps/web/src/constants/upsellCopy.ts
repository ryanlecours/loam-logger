/**
 * Upgrade CTA copy, keyed by the gated feature.
 *
 * Tone rules (keep every entry honest to these):
 * - Rider-to-rider, never SaaS-salesy. Lead with the riding/wrenching
 *   benefit, not "upgrade now". One cultural wink per surface, max.
 * - CTAs live only where the missing value is felt in context. No launch
 *   modals, no interstitials, no push-notification upsells, no urgency or
 *   scarcity language, no "unlock" spam.
 * - One inline upsell card per screen, max — every other gated spot gets a
 *   quiet Pro chip. Dismissed cards stay dismissed (persisted per surface).
 * - Never upsell inside error paths, except the bike-limit message.
 */
import { BIKE_LIMIT_UPSELL_LINE } from '@loam/shared';

export const UPSELL_COPY = {
  predictions: {
    title: 'Know before it blows.',
    body: 'Pro estimates the rides left before your fork, pads, and pivots need service — so you’re wrenching on your schedule, not the trail’s.',
    dismissKey: 'upsell-dismissed-predictions',
  },
  weather: {
    title: 'Hero dirt or mud slog?',
    body: 'Pro logs the conditions on every ride — wet rides wear parts faster, and your service estimates know it.',
    dismissKey: 'upsell-dismissed-weather',
  },
  pdfExport: {
    title: 'Paper trail for the next owner.',
    body: 'A documented service history helps your bike hold its value. Export the full log with Pro.',
    dismissKey: 'upsell-dismissed-pdf',
  },
  bikeLimit: {
    title: 'N+1, meet Pro.',
    // Shared with the API's TIER_LIMIT_EXCEEDED error message
    body: BIKE_LIMIT_UPSELL_LINE,
    dismissKey: 'upsell-dismissed-bike-limit',
  },
  importDepth: {
    title: 'Bring your whole history.',
    body: 'Pro imports every season you’ve ever logged — more history, smarter service estimates when you upgrade.',
    dismissKey: 'upsell-dismissed-import-depth',
  },
} as const;

export type UpsellFeature = keyof typeof UPSELL_COPY;
