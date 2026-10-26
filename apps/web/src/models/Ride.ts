export type WeatherCondition =
  | 'SUNNY'
  | 'CLOUDY'
  | 'RAINY'
  | 'SNOWY'
  | 'WINDY'
  | 'FOGGY'
  | 'UNKNOWN';

export interface RideWeather {
  id: string;
  tempC: number;
  feelsLikeC?: number | null;
  precipitationMm: number;
  windSpeedKph: number;
  humidity?: number | null;
  wmoCode: number;
  condition: WeatherCondition;
}

import type { RideLiftSummary } from '../lib/rideLift';

export interface Ride {
  id: string;
  startTime: string;
  durationSeconds: number;
  distanceMeters: number;
  elevationGainMeters: number;
  /** Climb after the rider's lift choice; show and total this one. */
  countedElevationGainMeters?: number | null;
  /** Mapped lifts on this ride; null when none. */
  lift?: RideLiftSummary | null;
  elevationLossMeters?: number | null;
  averageHr?: number | null;
  rideType: string;
  bikeId?: string | null;
  notes?: string | null;
  trailSystem?: string | null;
  location?: string | null;
  stravaActivityId?: string | null;
  garminActivityId?: string | null;
  whoopWorkoutId?: string | null;
  suuntoWorkoutId?: string | null;
  weather?: RideWeather | null;
}
