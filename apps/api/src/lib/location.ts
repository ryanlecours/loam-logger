import { LRUCache } from 'lru-cache';
import { prisma } from './prisma';

// In-memory LRU cache for hot-path reads
// Evicts least-recently-used entries when full
const memoryCache = new LRUCache<string, string | null>({ max: 1000 });

/**
 * Ride title result from reverse geocoding
 */
export type RideTitle = {
  title: string;
  subtitle?: string;
  quality: 'high' | 'med' | 'low';
  source: 'nominatim';
};

/**
 * US state name to abbreviation map
 */
const US_STATE_ABBREV: Record<string, string> = {
  'Alabama': 'AL',
  'Alaska': 'AK',
  'Arizona': 'AZ',
  'Arkansas': 'AR',
  'California': 'CA',
  'Colorado': 'CO',
  'Connecticut': 'CT',
  'Delaware': 'DE',
  'Florida': 'FL',
  'Georgia': 'GA',
  'Hawaii': 'HI',
  'Idaho': 'ID',
  'Illinois': 'IL',
  'Indiana': 'IN',
  'Iowa': 'IA',
  'Kansas': 'KS',
  'Kentucky': 'KY',
  'Louisiana': 'LA',
  'Maine': 'ME',
  'Maryland': 'MD',
  'Massachusetts': 'MA',
  'Michigan': 'MI',
  'Minnesota': 'MN',
  'Mississippi': 'MS',
  'Missouri': 'MO',
  'Montana': 'MT',
  'Nebraska': 'NE',
  'Nevada': 'NV',
  'New Hampshire': 'NH',
  'New Jersey': 'NJ',
  'New Mexico': 'NM',
  'New York': 'NY',
  'North Carolina': 'NC',
  'North Dakota': 'ND',
  'Ohio': 'OH',
  'Oklahoma': 'OK',
  'Oregon': 'OR',
  'Pennsylvania': 'PA',
  'Rhode Island': 'RI',
  'South Carolina': 'SC',
  'South Dakota': 'SD',
  'Tennessee': 'TN',
  'Texas': 'TX',
  'Utah': 'UT',
  'Vermont': 'VT',
  'Virginia': 'VA',
  'Washington': 'WA',
  'West Virginia': 'WV',
  'Wisconsin': 'WI',
  'Wyoming': 'WY',
  'District of Columbia': 'DC',
};

/**
 * POI categories that are trusted for ride title names.
 * Avoids using random road segment names.
 */
const TRUSTED_POI_CATEGORIES = new Set([
  'leisure',    // parks, trails, nature reserves
  'tourism',    // viewpoints, attractions
  'natural',    // peaks, forests, water features
  'amenity',    // parking lots at trailheads
]);

/**
 * Nominatim reverse geocode response shape
 */
type NominatimResponse = {
  name?: string;
  category?: string;
  type?: string;
  addresstype?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    hamlet?: string;
    municipality?: string;
    state?: string;
    state_district?: string;
    county?: string;
    country?: string;
    country_code?: string;
  };
};

// Coordinate precision: 3 decimal places (~111m resolution)
// Using rounding to center the cache cell around the true coordinate
const COORDINATE_PRECISION = 3;

// Rate limiting for Nominatim API (max 1 request per second)
// Uses mutex to serialize requests and ensure 1.1s spacing
const NOMINATIM_MIN_INTERVAL_MS = 1100; // 1.1 seconds to be safe
let lastNominatimRequest = 0;
let nominatimMutex: Promise<void> = Promise.resolve();

/**
 * Acquire rate limit slot for Nominatim API.
 * Ensures minimum 1.1 second spacing between requests using a mutex queue.
 * Each request waits for all previous requests to complete before checking rate limit.
 */
const acquireNominatimSlot = async (): Promise<void> => {
  // Atomically claim our position in the queue
  const myTurn = nominatimMutex;
  let releaseMutex!: () => void;
  nominatimMutex = new Promise((resolve) => {
    releaseMutex = resolve;
  });

  // Wait for all previous requests to complete
  await myTurn;

  // Now we have exclusive access - check rate limit
  const elapsed = Date.now() - lastNominatimRequest;
  if (elapsed < NOMINATIM_MIN_INTERVAL_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, NOMINATIM_MIN_INTERVAL_MS - elapsed)
    );
  }

  // Record timestamp and release mutex for next request
  lastNominatimRequest = Date.now();
  releaseMutex();
};

/**
 * Round a coordinate to the configured precision for cache lookup.
 * Uses toFixed which rounds (not floors), centering the cache cell.
 */
const roundCoordinate = (coord: number): number => {
  return parseFloat(coord.toFixed(COORDINATE_PRECISION));
};

/**
 * Generate a cache key for lat/lon coordinates.
 * Rounds to 3 decimal places (~111m precision) to group nearby locations.
 */
const getCacheKey = (lat: number, lon: number): string => {
  const roundedLat = roundCoordinate(lat).toFixed(COORDINATE_PRECISION);
  const roundedLon = roundCoordinate(lon).toFixed(COORDINATE_PRECISION);
  return `${roundedLat}:${roundedLon}`;
};

/**
 * Get cached geocode result from memory or DB.
 * Priority: Memory (fast) -> DB (persistent)
 */
const getCachedGeocode = async (
  lat: number,
  lon: number
): Promise<string | null | undefined> => {
  const cacheKey = getCacheKey(lat, lon);
  const roundedLat = roundCoordinate(lat);
  const roundedLon = roundCoordinate(lon);

  // Try memory cache first (hot path) - get() also promotes to most-recently-used
  const memoryCached = memoryCache.get(cacheKey);
  if (memoryCached !== undefined) {
    return memoryCached;
  }

  // Try DB second (persistent)
  try {
    const dbCached = await prisma.geoCache.findUnique({
      where: {
        lat_lon: { lat: roundedLat, lon: roundedLon },
      },
    });
    if (dbCached) {
      // Populate memory cache for future hits (LRU handles eviction)
      memoryCache.set(cacheKey, dbCached.location);
      return dbCached.location;
    }
  } catch (error) {
    console.warn('[ReverseGeocode] DB cache read failed:', error);
  }

  return undefined; // Not found in any cache
};

/**
 * Store geocode result in memory and DB cache.
 */
const setCachedGeocode = async (
  lat: number,
  lon: number,
  value: string | null
): Promise<void> => {
  const cacheKey = getCacheKey(lat, lon);
  const roundedLat = roundCoordinate(lat);
  const roundedLon = roundCoordinate(lon);

  // Store in memory cache (LRU handles eviction automatically)
  memoryCache.set(cacheKey, value);

  // Store in DB (persistent)
  try {
    await prisma.geoCache.upsert({
      where: {
        lat_lon: { lat: roundedLat, lon: roundedLon },
      },
      create: {
        lat: roundedLat,
        lon: roundedLon,
        location: value,
      },
      update: {
        location: value,
      },
    });
  } catch (error) {
    console.warn('[ReverseGeocode] DB cache write failed:', error);
  }
};

/**
 * Special country code overrides for display.
 * Most countries use their ISO 3166-1 alpha-2 code directly from Nominatim.
 * These overrides handle cases where we want a different format.
 */
const COUNTRY_CODE_OVERRIDES: Record<string, string> = {
  us: 'USA',
  gb: 'UK',
};

/**
 * Get country display code from Nominatim response.
 * Prefers country_code (ISO 3166-1 alpha-2) with overrides for common cases.
 */
const getCountryCode = (
  countryCode: string | null | undefined,
  countryName: string | null | undefined
): string | null => {
  if (countryCode) {
    const code = countryCode.toLowerCase();
    return COUNTRY_CODE_OVERRIDES[code] ?? countryCode.toUpperCase();
  }
  // Fallback to country name if no code available
  return countryName ?? null;
};

/**
 * Get state display value - abbreviated for US, full name for others.
 */
const getStateDisplay = (
  state: string | null | undefined,
  countryCode: string | null | undefined
): string | null => {
  if (!state) return null;

  // US states get abbreviated
  if (countryCode?.toLowerCase() === 'us') {
    return US_STATE_ABBREV[state] ?? state;
  }

  return state;
};

/**
 * Build a user-friendly ride title from Nominatim response.
 * Returns structured title with POI name (if trusted) and locality.
 */
const buildRideTitle = (data: NominatimResponse): RideTitle | null => {
  const address = data.address;
  if (!address) return null;

  // Extract locality (city-like field)
  const locality =
    address.city ||
    address.town ||
    address.village ||
    address.hamlet ||
    address.municipality ||
    address.county ||
    null;

  const state = address.state || address.state_district || null;
  const countryCode = address.country_code;
  const stateDisplay = getStateDisplay(state, countryCode);

  // Build subtitle: "Bellingham, WA" or "British Columbia, CA"
  let subtitle: string | null = null;
  if (locality && stateDisplay) {
    subtitle = `${locality}, ${stateDisplay}`;
  } else if (locality) {
    subtitle = locality;
  } else if (stateDisplay) {
    const country = getCountryCode(countryCode, address.country);
    subtitle = country ? `${stateDisplay}, ${country}` : stateDisplay;
  }

  // Check if POI name is trustworthy
  const category = data.category;
  const poiName = data.name;
  const hasTrustedPoi =
    poiName &&
    category &&
    TRUSTED_POI_CATEGORIES.has(category) &&
    poiName.toLowerCase() !== locality?.toLowerCase(); // Don't duplicate locality

  // Build the title
  let title: string;
  let quality: RideTitle['quality'];

  if (hasTrustedPoi && subtitle) {
    // High quality: "Galbraith Mountain Trailhead · Bellingham, WA"
    title = `${poiName} · ${subtitle}`;
    quality = 'high';
  } else if (hasTrustedPoi) {
    // POI but no locality
    title = poiName;
    quality = 'med';
  } else if (subtitle) {
    // No POI, just locality: "Bellingham, WA"
    title = subtitle;
    quality = 'med';
  } else if (stateDisplay) {
    // Only state available
    title = stateDisplay;
    quality = 'low';
  } else {
    // Nothing useful
    return null;
  }

  return {
    title,
    subtitle: subtitle ?? undefined,
    quality,
    source: 'nominatim',
  };
};

/**
 * Reverse geocode lat/lon to city, state, country using OpenStreetMap Nominatim API.
 * Returns RideTitle with user-friendly format like "Galbraith Mountain · Bellingham, WA".
 * Results are cached in DB with in-memory LRU for hot reads.
 * Respects Nominatim usage policy (1 req/sec, User-Agent required).
 */
export const reverseGeocode = async (
  lat: number,
  lon: number
): Promise<RideTitle | null> => {
  // Validate coordinate ranges
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    console.warn(`[ReverseGeocode] Invalid latitude: ${lat}`);
    return null;
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    console.warn(`[ReverseGeocode] Invalid longitude: ${lon}`);
    return null;
  }

  // Check cache first - returns JSON with title and quality, or legacy plain text
  const cached = await getCachedGeocode(lat, lon);
  if (cached !== undefined) {
    if (cached === null) return null;

    // Try to parse as JSON (new format: {title, quality})
    try {
      const parsed = JSON.parse(cached) as { title: string; quality: RideTitle['quality'] };
      if (parsed.title && parsed.quality) {
        return {
          title: parsed.title,
          quality: parsed.quality,
          source: 'nominatim',
        };
      }
    } catch {
      // Not valid JSON - treat as legacy plain text title, assume medium quality
    }

    // Legacy plain text format - return with medium quality
    return {
      title: cached,
      quality: 'med',
      source: 'nominatim',
    };
  }

  try {
    // Acquire rate limit slot before making request (1 req/sec max)
    await acquireNominatimSlot();

    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.searchParams.set('lat', lat.toString());
    url.searchParams.set('lon', lon.toString());
    url.searchParams.set('format', 'json');
    url.searchParams.set('addressdetails', '1');

    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'LoamLogger/1.0 (ryan.lecours@loamlogger.app)',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.warn(`[ReverseGeocode] Failed: ${response.status}`);
      return null;
    }

    const data = (await response.json()) as NominatimResponse;

    // Build structured ride title from response
    const rideTitle = buildRideTitle(data);

    if (!rideTitle) {
      // Cache null result to avoid repeated lookups for ocean/wilderness
      await setCachedGeocode(lat, lon, null);
      return null;
    }

    // Cache title and quality as JSON
    await setCachedGeocode(
      lat,
      lon,
      JSON.stringify({ title: rideTitle.title, quality: rideTitle.quality })
    );

    return rideTitle;
  } catch (error) {
    console.warn('[ReverseGeocode] Error:', error);
    return null;
  }
};

export const buildLocationString = (
  parts: Array<string | null | undefined>
): string | null => {
  const cleaned = parts
    .map((part) => (typeof part === 'string' ? part.trim() : part))
    .filter((part): part is string => Boolean(part && part.length > 0));

  return cleaned.length ? cleaned.join(', ') : null;
};

export const formatLatLon = (
  lat?: number | null,
  lon?: number | null
): string | null => {
  if (!Number.isFinite(lat ?? NaN) || !Number.isFinite(lon ?? NaN)) {
    return null;
  }

  const latStr = (lat as number).toFixed(3);
  const lonStr = (lon as number).toFixed(3);
  return `Lat ${latStr}, Lon ${lonStr}`;
};

export const deriveLocation = (opts: {
  city?: string | null;
  state?: string | null;
  country?: string | null;
  fallback?: string | null;
  lat?: number | null;
  lon?: number | null;
}): string | null => {
  const singleValue = opts.city ?? opts.state ?? opts.country ?? opts.fallback ?? null;

  return (
    buildLocationString([opts.city, opts.state]) ??
    buildLocationString([opts.city, opts.country]) ??
    buildLocationString([opts.state, opts.country]) ??
    (singleValue?.trim() || null) ??
    formatLatLon(opts.lat, opts.lon)
  );
};

/**
 * Async version of deriveLocation that uses reverse geocoding as fallback.
 * When city/state/country are not available, attempts to reverse geocode lat/lon.
 * Returns RideTitle for consistency with reverseGeocode.
 */
export const deriveLocationAsync = async (opts: {
  city?: string | null;
  state?: string | null;
  country?: string | null;
  fallback?: string | null;
  lat?: number | null;
  lon?: number | null;
}): Promise<RideTitle | null> => {
  // First, try the sync version to get location from existing fields
  const syncResult = deriveLocation(opts);

  // If we got a real location (not lat/lon format), return it as medium quality
  if (syncResult && !syncResult.startsWith('Lat ')) {
    return {
      title: syncResult,
      quality: 'med',
      source: 'nominatim', // Not actually from nominatim but keeping consistent
    };
  }

  // If we have lat/lon, try reverse geocoding
  if (Number.isFinite(opts.lat ?? NaN) && Number.isFinite(opts.lon ?? NaN)) {
    const geocoded = await reverseGeocode(opts.lat as number, opts.lon as number);
    if (geocoded) {
      return geocoded;
    }
  }

  // Fall back to lat/lon format as low quality
  if (syncResult) {
    return {
      title: syncResult,
      quality: 'low',
      source: 'nominatim',
    };
  }

  return null;
};

export const shouldApplyAutoLocation = (
  existing: string | null | undefined,
  incoming: string | null
): string | undefined => {
  if (!incoming) return undefined;
  if (existing && existing.trim().length > 0) return undefined;
  return incoming;
};
