import type { WeatherStats } from '../types';
import type { WeatherCondition } from '../../../models/Ride';
import { conditionIcon, conditionLabel, conditionTint } from '../../../lib/weather';

const ORDER: WeatherCondition[] = [
  'SUNNY',
  'CLOUDY',
  'RAINY',
  'SNOWY',
  'WINDY',
  'FOGGY',
  'UNKNOWN',
];

export default function WeatherSection({ stats }: { stats: WeatherStats }) {
  const pending = stats.totalRides - stats.totalWithWeather;

  if (stats.totalWithWeather === 0) {
    return <p className="section-empty">No weather data yet for this timeframe.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
        {ORDER.map((cond) => {
          const count = stats.breakdown[cond];
          if (count === 0) return null;
          const Icon = conditionIcon(cond);
          const tint = cond === 'UNKNOWN' ? undefined : conditionTint(cond);
          return (
            <div
              key={cond}
              className="flex flex-col items-center rounded-md border border-[color:var(--surface-2)] bg-[color:var(--surface-1)] px-2 py-3"
            >
              <Icon size={20} color={tint} className={tint ? '' : 'text-[color:var(--text-muted)]'} />
              <div className="mt-1 text-sm font-semibold text-[color:var(--text)]">{count}</div>
              <div className="text-[11px] text-[color:var(--text-muted)]">
                {conditionLabel(cond)}
              </div>
            </div>
          );
        })}
      </div>
      {pending > 0 && (
        <p className="text-[11px] text-[color:var(--text-muted)]">
          {pending} ride{pending === 1 ? '' : 's'} still pending weather fetch.
        </p>
      )}
    </div>
  );
}
