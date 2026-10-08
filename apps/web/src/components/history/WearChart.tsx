import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { CHART } from './chartTheme';

const monthLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });

/**
 * Cumulative hours over a component's life, one point per month, with its
 * service dates marked. Shared by the owner's history page and the public share
 * page so the two always draw the same chart.
 */
export function WearChart({
  points,
  serviceDates,
}: {
  points: Array<{ date: string; cumulativeHours: number }>;
  /** ISO dates of SERVICE logs; inspections do not mark the chart. */
  serviceDates: string[];
}) {
  const data = useMemo(
    () =>
      points.map((p) => ({
        date: p.date,
        label: monthLabel(p.date),
        hours: Number(p.cumulativeHours.toFixed(1)),
      })),
    [points]
  );

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: CHART.axis, fontSize: 11 }}
            stroke={CHART.grid}
            minTickGap={24}
          />
          <YAxis
            tick={{ fill: CHART.axis, fontSize: 11 }}
            stroke={CHART.grid}
            width={40}
            unit="h"
          />
          <Tooltip
            contentStyle={{
              background: 'rgb(22, 22, 26)',
              border: '1px solid rgba(58, 58, 62, 0.7)',
              borderRadius: 12,
              fontSize: 12,
            }}
            labelStyle={{ color: CHART.axis }}
            formatter={(v) => [`${Number(v ?? 0)}h`, 'Cumulative']}
          />
          {serviceDates.map((iso, i) => (
            <ReferenceLine
              key={`${iso}-${i}`}
              x={monthLabel(iso)}
              stroke={CHART.serviceMark}
              strokeDasharray="3 3"
            />
          ))}
          <Area
            type="monotone"
            dataKey="hours"
            stroke={CHART.wearLine}
            strokeWidth={2}
            fill={CHART.wearFill}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
