import { GARMIN_CONNECT_APP_NAME } from '@loam/shared';

/**
 * The official Garmin Connect app tile.
 *
 * The Garmin API Brand Guidelines, under AUTHENTICATING APPLICATIONS: "use the
 * full app name and tile to display the connection. Do not abbreviate, truncate
 * or stylize the Garmin app name." This component exists so every connect
 * surface shows the real mark instead of a stand-in glyph — a generic mountain
 * or watch icon standing in for Garmin is precisely the mischaracterization
 * the brand review looks for.
 *
 * Rules this encodes, all from the guidelines:
 *  - The artwork is never recolored, cropped, rotated or animated. Callers get
 *    a size, nothing else.
 *  - It is never used as an avatar or decorative badge, and never on a surface
 *    where Garmin data or the Garmin connection is not the subject.
 *  - It is not a data-source attribution. Use formatGarminSource() for that —
 *    ride data comes from a device, not from the Garmin Connect app.
 *
 * Asset: apps/web/public/logos/Garmin_Connect_app_1024x1024-02.png, supplied by
 * Garmin. Do not substitute a redrawn or re-exported version.
 */
export default function GarminConnectMark({
  size = 24,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src="/logos/Garmin_Connect_app_1024x1024-02.png"
      // Decorative in every current placement — the visible label beside it
      // already names Garmin Connect, so announcing the tile too would just
      // duplicate it for screen readers.
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      // No corner rounding. The tile ships with its own rounded corners already
      // cut into the artwork as transparency, measured at 14.9% of its width.
      // The rounded-[22%] that used to be here was LARGER than that, so rather
      // than tracing the existing edge it clipped into Garmin's visible mark.
      // The asset renders as a rounded square untouched.
      className={className}
      style={{ width: size, height: size }}
    />
  );
}

export { GARMIN_CONNECT_APP_NAME };
