import { useMemo } from 'react';
import type { RideStats } from '../RideStatsCard/types';
import { formatDistance, formatPercentChange, getRandomDefaultMessage } from './greetingMessages';

export type InsightType = 'pr' | 'streak' | 'improvement' | 'maintenance' | 'milestone' | 'welcome' | 'default';

export interface GreetingInsight {
  type: InsightType;
  message: string;
  emoji: string;
}

interface BikeHealth {
  criticalCount: number;
  warningCount: number;
}

interface UseGreetingInsightOptions {
  stats: RideStats | null;
  bikeHealth: BikeHealth;
  totalHoursAllTime?: number;
}

export function useGreetingInsight({
  stats,
  bikeHealth,
  totalHoursAllTime = 0,
}: UseGreetingInsightOptions): GreetingInsight {
  return useMemo(() => {
    // Priority 1: Personal Records (check if any exist and highlight the first one)
    if (stats?.trends.personalRecords && stats.trends.personalRecords.length > 0) {
      const record = stats.trends.personalRecords[0];
      // Only celebrate if it's from a recent ride (within last 7 days)
      const recordDate = new Date(record.date);
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      if (recordDate > weekAgo) {
        let recordMessage = '';
        switch (record.type) {
          case 'longest_ride':
            recordMessage = `New distance PR: ${formatDistance(record.value)}`;
            break;
          case 'most_elevation':
            recordMessage = `New climbing PR: ${record.value.toLocaleString()} ft`;
            break;
          case 'longest_duration': {
            const hours = Math.floor(record.value / 3600);
            const mins = Math.round((record.value % 3600) / 60);
            recordMessage = `New duration PR: ${hours > 0 ? `${hours}h ${mins}m` : `${mins}m`}`;
            break;
          }
        }

        if (recordMessage) {
          return {
            type: 'pr',
            message: recordMessage,
            emoji: '🏆',
          };
        }
      }
    }

    // Priority 2: Active Streak (if 2+ days)
    if (stats?.trends.currentStreak && stats.trends.currentStreak >= 2) {
      return {
        type: 'streak',
        message: `You're on a ${stats.trends.currentStreak}-day riding streak!`,
        emoji: '🔥',
      };
    }

    // Priority 3: Week-over-week improvement (if positive and significant)
    const weekOverWeekDistance = stats?.trends.weekOverWeekDistance;
    if (weekOverWeekDistance !== null && weekOverWeekDistance !== undefined && weekOverWeekDistance >= 20) {
      return {
        type: 'improvement',
        message: `You rode ${formatPercentChange(weekOverWeekDistance)} more this week`,
        emoji: '📈',
      };
    }

    // Priority 4: Bike maintenance alerts
    if (bikeHealth.criticalCount > 0) {
      const plural = bikeHealth.criticalCount > 1 ? 's need' : ' needs';
      return {
        type: 'maintenance',
        message: `${bikeHealth.criticalCount} component${plural} service soon`,
        emoji: '🔧',
      };
    }

    if (bikeHealth.warningCount > 0) {
      return {
        type: 'maintenance',
        message: 'Your gear is due for a check-up',
        emoji: '🔧',
      };
    }

    // Priority 5: Milestones (hours ridden)
    if (totalHoursAllTime >= 100 && totalHoursAllTime < 110) {
      return {
        type: 'milestone',
        message: "You've crossed 100 hours on the trails!",
        emoji: '🎉',
      };
    }
    if (totalHoursAllTime >= 250 && totalHoursAllTime < 260) {
      return {
        type: 'milestone',
        message: "250+ hours of trail time logged!",
        emoji: '🎉',
      };
    }
    if (totalHoursAllTime >= 500 && totalHoursAllTime < 510) {
      return {
        type: 'milestone',
        message: "500 hours — you're a trail legend!",
        emoji: '🎉',
      };
    }

    // Priority 6: If they have any rides this week, encourage them
    if (stats?.rideCount.totalRides && stats.rideCount.totalRides > 0) {
      const rides = stats.rideCount.totalRides;
      const distance = stats.distance;
      return {
        type: 'default',
        message: `${rides} ride${rides > 1 ? 's' : ''} and ${formatDistance(distance)} this week`,
        emoji: '🚵',
      };
    }

    // Priority 7: Default motivational message
    return {
      type: 'default',
      message: getRandomDefaultMessage(),
      emoji: '🤙',
    };
  }, [stats, bikeHealth, totalHoursAllTime]);
}
