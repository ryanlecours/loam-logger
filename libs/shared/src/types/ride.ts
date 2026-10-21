export interface Ride {
  id: string;
  startTime: string;
  durationSeconds: number;
  distanceMeters: number;
  elevationGainMeters: number;
  elevationLossMeters?: number | null;
  averageHr?: number | null;
  rideType: string;
  bikeId?: string | null;
  notes?: string | null;
  trailSystem?: string | null;
  location?: string | null;
}
