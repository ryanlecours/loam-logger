import { CableCar } from 'lucide-react';
import { liftTagLabel, type RideLiftSummary } from '../lib/rideLift';
import { Badge } from './ui';

/**
 * Compact "Chairlift detected" tag for a ride row. The label comes from the
 * mapped lifts' kinds (OpenStreetMap data), so a list showing it also shows
 * the OSM credit (showsLiftData). Whether the lift's climb counts is told by
 * the tooltip and screen reader text; the row's climb figure already reflects
 * it, and the ride's own panel is where the rider changes it.
 */
export default function LiftTag({ lift }: { lift: RideLiftSummary }) {
  const label = liftTagLabel(lift.segments.map((s) => s.kind));
  const climbNote = lift.countElevation ? 'Lift climb counted' : 'Lift climb not counted';
  return (
    <Badge
      variant="info"
      icon={<CableCar size={11} aria-hidden="true" />}
      title={`${label}. ${climbNote}.`}
      aria-label={`${label}. ${climbNote}.`}
    >
      {label}
    </Badge>
  );
}
