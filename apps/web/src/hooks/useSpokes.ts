import { useState, useCallback, useRef } from 'react';
import { getAuthHeaders } from '@/lib/csrf';

export interface SpokesSuspension {
  front?: {
    travel?: number;
    travelMM?: number;  // Direct endpoint uses travelMM
    component?: {
      make?: string;
      model?: string;
      description?: string;
    };
  };
  rear?: {
    travel?: number;
    travelMM?: number;  // Direct endpoint uses travelMM
    component?: {
      make?: string;
      model?: string;
      description?: string;
    };
  };
}

export interface SpokesComponentEntry {
  make?: string;
  maker?: string;  // Some endpoints use 'maker' instead of 'make'
  model?: string;
  description?: string;
  display?: string;  // Display string from API
  kind?: string;  // e.g., 'dropper' for seatpost
  material?: string;  // For fork, handlebar, rims
}

export interface SpokesGeometry {
  stemLengthMM?: number;
  handlebarWidthMM?: number;
  crankLengthMM?: number;
  frontTravelMM?: number;
  rearTravelMM?: number;
  rakeMM?: number;  // Fork offset
}

export interface SpokesSize {
  name: string;
  riderHeight?: {
    minCM?: number;
    maxCM?: number;
  };
  geometry?: {
    source?: SpokesGeometry;
    computed?: SpokesGeometry;
  };
}

export interface SpokesImage {
  url: string;
  dimensions?: {
    width: number;
    height: number;
  };
  colorKey?: string;
}

export interface SpokesMotorEntry extends SpokesComponentEntry {
  powerW?: number;
  torqueNm?: number;
}

export interface SpokesBatteryEntry extends SpokesComponentEntry {
  capacityWh?: number;
}

export interface SpokesComponents {
  fork?: SpokesComponentEntry;
  shock?: SpokesComponentEntry;
  rearShock?: SpokesComponentEntry;
  drivetrain?: SpokesComponentEntry;
  wheels?: SpokesComponentEntry;
  dropper?: SpokesComponentEntry;
  brakes?: SpokesComponentEntry;
  rearDerailleur?: SpokesComponentEntry;
  crank?: SpokesComponentEntry;
  cassette?: SpokesComponentEntry;
  rims?: SpokesComponentEntry;
  tires?: SpokesComponentEntry;
  stem?: SpokesComponentEntry;
  handlebar?: SpokesComponentEntry;
  saddle?: SpokesComponentEntry;
  seatpost?: SpokesComponentEntry & { kind?: 'dropper' | 'rigid' };
  chain?: SpokesComponentEntry;
  pedals?: SpokesComponentEntry;
  // E-bike components
  motor?: SpokesMotorEntry;
  battery?: SpokesBatteryEntry;
}

export interface SpokesBikeDetails {
  id: string;
  makerId: string;
  maker: string;
  model: string;
  year: number;
  family: string;
  category: string;
  subcategory: string | null;
  url?: string;
  thumbnailUrl?: string;  // Bike image from direct endpoint
  buildKind?: string;
  isFrameset?: boolean;
  isEbike?: boolean;
  gender?: string;
  frameMaterial?: string;
  hangerStandard?: string;
  suspension?: SpokesSuspension;
  components?: SpokesComponents;
  sizes?: SpokesSize[];  // Available sizes with geometry
  images?: SpokesImage[];  // Additional images for fallback
}

export function useSpokes() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cache bike details to avoid redundant API calls
  const cacheRef = useRef<Map<string, SpokesBikeDetails>>(new Map());

  const getBikeDetails = useCallback(async (spokesId: string): Promise<SpokesBikeDetails | null> => {
    if (!spokesId) return null;

    // Check cache first
    const cached = cacheRef.current.get(spokesId);
    if (cached) {
      return cached;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/api/spokes/bike/${encodeURIComponent(spokesId)}`,
        {
          credentials: 'include',
          headers: getAuthHeaders(),
        }
      );

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error('Failed to fetch bike details');
      }

      const data = await response.json();
      const bike = data.bike;

      // Store in cache
      if (bike) {
        cacheRef.current.set(spokesId, bike);
      }

      return bike;
    } catch (err) {
      console.error('Error fetching bike details:', err);
      setError('Failed to load bike details');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { getBikeDetails, isLoading, error };
}
