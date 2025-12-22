export interface BikeTimeData {
  name: string;
  hours: number;
}

export interface RideStats {
  distance: number;     // in miles
  elevation: number;    // in feet
  hours: number;        // total time ridden
  bikeTime: BikeTimeData[];
}

export type Timeframe = '1w' | '1m' | '3m' | 'YTD';

export type RideStatsByTimeframe = Record<Timeframe, RideStats>;
