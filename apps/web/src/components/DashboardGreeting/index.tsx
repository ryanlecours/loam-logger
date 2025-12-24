import { motion } from 'framer-motion';
import type { RideStats } from '../RideStatsCard/types';
import { getTimeOfDayGreeting } from './greetingMessages';
import { useGreetingInsight } from './useGreetingInsight';

interface DashboardGreetingProps {
  firstName: string;
  stats: RideStats | null;
  bikeHealth: {
    criticalCount: number;
    warningCount: number;
  };
  totalHoursAllTime?: number;
}

export default function DashboardGreeting({
  firstName,
  stats,
  bikeHealth,
  totalHoursAllTime,
}: DashboardGreetingProps) {
  const timeGreeting = getTimeOfDayGreeting();
  const insight = useGreetingInsight({ stats, bikeHealth, totalHoursAllTime });

  return (
    <div className="dashboard-greeting">
      <h1 className="greeting-headline">
        {timeGreeting}, {firstName}
      </h1>
      <motion.p
        className={`greeting-insight greeting-insight--${insight.type}`}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.3 }}
      >
        <span className="greeting-emoji">{insight.emoji}</span>
        <span className="greeting-message">{insight.message}</span>
      </motion.p>
    </div>
  );
}
