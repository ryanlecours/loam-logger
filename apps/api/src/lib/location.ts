import { getRedisConnection, isRedisReady } from './redis';

// In-memory cache fallback (used when Redis is unavailable)
// Uses FIFO eviction when max size is reached
const memoryCache = new Map<string, { value: string | null; expiresAt: number }>();
const MEMORY_CACHE_MAX_SIZE = 1000;
// 1 year TTL - coordinates map to the same location indefinitely.
// Using a finite TTL allows for rare OSM data corrections and prevents
// unbounded cache growth if Redis persistence is enabled.
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 365;

// Rate limiting for Nominatim API (max 1 request per second)
// Using a simple queue with mutex to serialize requests globally
const NOMINATIM_MIN_INTERVAL_MS = 1100; // 1.1 seconds to be safe
let lastNominatimRequest = 0;
let nominatimQueuePromise: Promise<void> = Promise.resolve();

/**
 * Acquire rate limit slot for Nominatim API.
 * Ensures minimum 1.1 second spacing between requests.
 */
const acquireNominatimSlot = async (): Promise<void> => {
  // Chain onto the queue to serialize all requests
  const previousPromise = nominatimQueuePromise;

  let resolveSlot: () => void = () => {};
  nominatimQueuePromise = new Promise((resolve) => {
    resolveSlot = resolve;
  });

  // Wait for previous request to complete
  await previousPromise;

  // Wait for rate limit interval
  const now = Date.now();
  const timeSinceLastRequest = now - lastNominatimRequest;
  if (timeSinceLastRequest < NOMINATIM_MIN_INTERVAL_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, NOMINATIM_MIN_INTERVAL_MS - timeSinceLastRequest)
    );
  }

  lastNominatimRequest = Date.now();

  // Release the queue so the next request can start waiting.
  // The timestamp is already recorded, so the next request will
  // wait 1.1s from now regardless of how fast this fetch completes.
  resolveSlot();
};

/**
 * Generate a cache key for lat/lon coordinates.
 * Rounds to 3 decimal places (~111m precision) to group nearby locations.
 */
const getCacheKey = (lat: number, lon: number): string => {
  const roundedLat = lat.toFixed(3);
  const roundedLon = lon.toFixed(3);
  return `geocode:${roundedLat}:${roundedLon}`;
};

/**
 * Get cached geocode result from Redis or memory cache.
 */
const getCachedGeocode = async (key: string): Promise<string | null | undefined> => {
  // Try Redis first
  if (isRedisReady()) {
    try {
      const redis = getRedisConnection();
      const cached = await redis.get(key);
      if (cached !== null) {
        return cached === '__NULL__' ? null : cached;
      }
    } catch (error) {
      console.warn('[ReverseGeocode] Redis cache read failed:', error);
    }
  }

  // Fallback to memory cache
  const memCached = memoryCache.get(key);
  if (memCached && memCached.expiresAt > Date.now()) {
    return memCached.value;
  }

  // Clean up expired entry
  if (memCached) {
    memoryCache.delete(key);
  }

  return undefined; // Not found in any cache
};

/**
 * Store geocode result in Redis and memory cache.
 */
const setCachedGeocode = async (key: string, value: string | null): Promise<void> => {
  const expiresAt = Date.now() + CACHE_TTL_SECONDS * 1000;

  // Store in memory cache (with size limit)
  if (memoryCache.size >= MEMORY_CACHE_MAX_SIZE) {
    // Remove oldest entry (first in Map)
    const firstKey = memoryCache.keys().next().value;
    if (firstKey) memoryCache.delete(firstKey);
  }
  memoryCache.set(key, { value, expiresAt });

  // Store in Redis
  if (isRedisReady()) {
    try {
      const redis = getRedisConnection();
      // Store null as special marker since Redis can't store null
      const storeValue = value === null ? '__NULL__' : value;
      await redis.setex(key, CACHE_TTL_SECONDS, storeValue);
    } catch (error) {
      console.warn('[ReverseGeocode] Redis cache write failed:', error);
    }
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
 * Reverse geocode lat/lon to city, state, country using OpenStreetMap Nominatim API.
 * Returns "City, State, USA" format or null if lookup fails.
 * Results are cached in Redis (1 year) with memory fallback.
 * Respects Nominatim usage policy (1 req/sec, User-Agent required).
 */
export const reverseGeocode = async (
  lat: number,
  lon: number
): Promise<string | null> => {
  // Validate coordinate ranges
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    console.warn(`[ReverseGeocode] Invalid latitude: ${lat}`);
    return null;
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    console.warn(`[ReverseGeocode] Invalid longitude: ${lon}`);
    return null;
  }

  const cacheKey = getCacheKey(lat, lon);

  // Check cache first
  const cached = await getCachedGeocode(cacheKey);
  if (cached !== undefined) {
    return cached;
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

    const data = (await response.json()) as {
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

    const address = data.address;
    if (!address) {
      // Cache null result to avoid repeated lookups for ocean/wilderness
      await setCachedGeocode(cacheKey, null);
      return null;
    }

    // Prioritize city-like fields
    const city =
      address.city ||
      address.town ||
      address.village ||
      address.hamlet ||
      address.municipality ||
      null;

    const state = address.state || address.state_district || null;
    const country = getCountryCode(address.country_code, address.country);

    // Build location string: "City, State, Country" or subset if parts missing
    const result = buildLocationString([city, state, country]);

    // Cache the result
    await setCachedGeocode(cacheKey, result);

    return result;
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
 */
export const deriveLocationAsync = async (opts: {
  city?: string | null;
  state?: string | null;
  country?: string | null;
  fallback?: string | null;
  lat?: number | null;
  lon?: number | null;
}): Promise<string | null> => {
  // First, try the sync version to get location from existing fields
  const syncResult = deriveLocation(opts);

  // If we got a real location (not lat/lon format), return it
  if (syncResult && !syncResult.startsWith('Lat ')) {
    return syncResult;
  }

  // If we have lat/lon, try reverse geocoding
  if (Number.isFinite(opts.lat ?? NaN) && Number.isFinite(opts.lon ?? NaN)) {
    const geocoded = await reverseGeocode(opts.lat as number, opts.lon as number);
    if (geocoded) {
      return geocoded;
    }
  }

  // Fall back to lat/lon format or null
  return syncResult;
};

export const shouldApplyAutoLocation = (
  existing: string | null | undefined,
  incoming: string | null
): string | undefined => {
  if (!incoming) return undefined;
  if (existing && existing.trim().length > 0) return undefined;
  return incoming;
};
