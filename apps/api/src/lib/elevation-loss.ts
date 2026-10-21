/**
 * Descent (elevation loss) as a provider reports it.
 *
 * `Ride.elevationLossMeters` is nullable, and the null is load-bearing: it
 * means "no source said", which clients hide, while 0 means a flat ride. So
 * every ingest path funnels the provider's figure through here rather than
 * defaulting to 0 the way elevation gain does.
 */

/** A finite, non-negative meters value, or null when the provider gave none. */
export function elevationLossFromProvider(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, value);
}

/**
 * WHOOP reports gain and net change (end minus start), never loss directly.
 * Loss is gain minus change when both are present. Both are phone-derived and
 * coarse, so a negative result (sensor drift) reads as null rather than 0.
 */
export function whoopElevationLoss(
  score: { altitude_gain_meter?: number; altitude_change_meter?: number } | undefined | null
): number | null {
  const gain = score?.altitude_gain_meter;
  const change = score?.altitude_change_meter;
  if (typeof gain !== 'number' || !Number.isFinite(gain)) return null;
  if (typeof change !== 'number' || !Number.isFinite(change)) return null;
  const loss = gain - change;
  return loss < 0 ? null : loss;
}
