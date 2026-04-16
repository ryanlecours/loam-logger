import { Thermometer, Droplets, Wind } from 'lucide-react';
import type { RideWeather } from '../models/Ride';
import {
  renderConditionIcon,
  conditionLabel,
  conditionTint,
  celsiusToFahrenheit,
  mmToInches,
  kphToMph,
} from '../lib/weather';

type Props = {
  weather: RideWeather;
  distanceUnit?: 'mi' | 'km';
};

export default function RideWeatherPanel({ weather, distanceUnit = 'mi' }: Props) {
  const isImperial = distanceUnit === 'mi';
  const tint = conditionTint(weather.condition);

  const tempValue = isImperial
    ? `${Math.round(celsiusToFahrenheit(weather.tempC))}°F`
    : `${Math.round(weather.tempC)}°C`;
  const precipValue = isImperial
    ? `${mmToInches(weather.precipitationMm).toFixed(2)} in`
    : `${weather.precipitationMm.toFixed(1)} mm`;
  const windValue = isImperial
    ? `${Math.round(kphToMph(weather.windSpeedKph))} mph`
    : `${Math.round(weather.windSpeedKph)} kph`;

  const feelsLikeValue =
    weather.feelsLikeC != null
      ? isImperial
        ? `${Math.round(celsiusToFahrenheit(weather.feelsLikeC))}°F`
        : `${Math.round(weather.feelsLikeC)}°C`
      : null;
  const humidityValue =
    weather.humidity != null ? `${Math.round(weather.humidity)}%` : null;

  return (
    <div className="rounded-lg border border-[color:var(--surface-2)] bg-[color:var(--surface-1)] p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)] mb-3">
        Weather
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile
          icon={renderConditionIcon(weather.condition, { size: 20, color: tint })}
          value={conditionLabel(weather.condition)}
          label="Condition"
        />
        <Tile
          icon={<Thermometer size={20} className="text-[color:var(--text-muted)]" />}
          value={tempValue}
          label="Temp"
        />
        <Tile
          icon={<Droplets size={20} className="text-[color:var(--text-muted)]" />}
          value={precipValue}
          label="Precip"
        />
        <Tile
          icon={<Wind size={20} className="text-[color:var(--text-muted)]" />}
          value={windValue}
          label="Wind"
        />
      </div>
      {(feelsLikeValue || humidityValue) && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[color:var(--text-muted)]">
          {feelsLikeValue && <span>Feels like {feelsLikeValue}</span>}
          {humidityValue && <span>Humidity {humidityValue}</span>}
        </div>
      )}
    </div>
  );
}

function Tile({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="flex flex-col items-center text-center py-2">
      {icon}
      <div className="mt-1 text-sm font-semibold text-[color:var(--text)]">{value}</div>
      <div className="text-[11px] text-[color:var(--text-muted)]">{label}</div>
    </div>
  );
}
