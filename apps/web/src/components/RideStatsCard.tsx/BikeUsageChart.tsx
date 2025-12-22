import { PieChart, Pie, Cell, Tooltip } from 'recharts';

const COLORS = ['#8884d8', '#82ca9d', '#ffc658'];

interface Props {
  data: { name: string; hours: number }[];
}

export default function BikeUsageChart({ data }: Props) {
  return (
    <PieChart width={300} height={300}>
      <Pie data={data} dataKey="hours" outerRadius={80} label>
        {data.map((_entry, i) => (
          <Cell key={`cell-${i}`} fill={COLORS[i % COLORS.length]} />
        ))}
      </Pie>
      <Tooltip />
    </PieChart>
  );
}
