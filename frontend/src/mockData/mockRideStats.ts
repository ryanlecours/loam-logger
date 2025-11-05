import type { RideStatsByTimeframe } from "../models/BikeTimeData";

export const mockRideStats: RideStatsByTimeframe = {
  '1w': {
    distance: 34.2,
    elevation: 3120,
    hours: 5,
    bikeTime: [
      { name: 'Propain Tyee CF 6', hours: 2 },
      { name: 'Transition Smuggler', hours: 3 },
    ],
  },
  '1m': {
    distance: 168.7,
    elevation: 15300,
    hours: 24,
    bikeTime: [
      { name: 'Propain Tyee CF 6', hours: 14 },
      { name: 'Transition Smuggler', hours: 8 },
      { name: 'Evil Wreckoning V3', hours: 2 },
    ],
  },
  '3m': {
    distance: 402.5,
    elevation: 38250,
    hours: 59,
    bikeTime: [
      { name: 'Propain Tyee CF 6', hours: 30 },
      { name: 'Transition Smuggler', hours: 20 },
      { name: 'Evil Wreckoning V3', hours: 9 },
    ],
  },
  'YTD': {
    distance: 1257.4,
    elevation: 120430,
    hours: 180,
    bikeTime: [
      { name: 'Propain Tyee CF 6', hours: 80 },
      { name: 'Transition Smuggler', hours: 70 },
      { name: 'Evil Wreckoning V3', hours: 30 },
    ],
  },
};
