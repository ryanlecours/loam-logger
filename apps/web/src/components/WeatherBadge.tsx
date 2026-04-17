import { renderConditionIcon, conditionTint, celsiusToFahrenheit } from '../lib/weather';
import type { WeatherCondition } from '../models/Ride';

type Weather = {
  tempC: number;
  condition: WeatherCondition;
};

type Props = {
  weather?: Weather | null;
  distanceUnit?: 'mi' | 'km';
  /** Icon/text size. `small` for list rows, `medium` for summary cards. */
  size?: 'small' | 'medium';
};

/**
 * Compact condition-icon + temperature chip for ride cards and list rows.
 * Renders nothing when weather is null so callers can drop it inline
 * without guarding.
 */
export default function WeatherBadge({
  weather,
  distanceUnit = 'mi',
  size = 'small',
}: Props) {
  if (!weather) return null;

  const isImperial = distanceUnit === 'mi';
  const temp = isImperial
    ? `${Math.round(celsiusToFahrenheit(weather.tempC))}°`
    : `${Math.round(weather.tempC)}°`;

  const iconSize = size === 'small' ? 14 : 16;
  const tint = conditionTint(weather.condition);

  return (
    <span className="inline-flex items-center gap-1 text-[color:var(--text-muted)]">
      {renderConditionIcon(weather.condition, { size: iconSize, color: tint })}
      <span className={size === 'small' ? 'text-xs' : 'text-sm'}>{temp}</span>
    </span>
  );
}
