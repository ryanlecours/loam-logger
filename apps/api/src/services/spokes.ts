import { getRedisConnection, isRedisReady } from '../lib/redis';

// API configuration
const SPOKES_API_BASE = 'https://api.99spokes.com/v1';
const SPOKES_API_KEY = process.env.SPOKES_API_KEY || '';

// Cache configuration
const SEARCH_CACHE_TTL_SECONDS = 60 * 60 * 24; // 24 hours for search results
const BIKE_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days for bike details
const MEMORY_CACHE_MAX_SIZE = 500;

// In-memory cache fallback
const memoryCache = new Map<string, { value: unknown; expiresAt: number }>();

// Rate limiting (conservative: 10 req/sec max)
const MIN_REQUEST_INTERVAL_MS = 100;
let lastRequestTime = 0;
let requestQueuePromise: Promise<void> = Promise.resolve();

// ─────────────────────────────────────────────────────────────────────────────
// Types matching 99spokes API response
// ─────────────────────────────────────────────────────────────────────────────

export interface SpokesSearchResult {
  id: string;
  maker: string;
  model: string;
  year: number;
  family: string;
  category: string;
  subcategory: string | null;
}

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

export interface SpokesComponent {
  make?: string;
  maker?: string;  // Some endpoints use 'maker' instead of 'make'
  model?: string;
  description?: string;
  kind?: string;  // e.g., 'dropper' for seatpost
}

export interface SpokesComponents {
  fork?: SpokesComponent;
  shock?: SpokesComponent;
  rearShock?: SpokesComponent;  // Some responses use rearShock
  drivetrain?: SpokesComponent;
  wheels?: SpokesComponent;
  rims?: SpokesComponent;
  tires?: SpokesComponent;
  dropper?: SpokesComponent;
  seatpost?: SpokesComponent & { kind?: 'dropper' | 'rigid' };
  stem?: SpokesComponent;
  handlebar?: SpokesComponent;
  saddle?: SpokesComponent;
  brakes?: SpokesComponent;
  rearDerailleur?: SpokesComponent;
  crank?: SpokesComponent;
  cassette?: SpokesComponent;
  chain?: SpokesComponent;
  pedals?: SpokesComponent;
  // E-bike components
  motor?: SpokesComponent & {
    powerW?: number;
    torqueNm?: number;
  };
  battery?: SpokesComponent & {
    capacityWh?: number;
  };
}

export interface SpokesBike {
  id: string;
  makerId: string;
  maker: string;
  year: number;
  model: string;
  family: string;
  category: string;
  subcategory: string | null;
  // Additional metadata from direct endpoint
  url?: string;  // 99spokes page URL
  thumbnailUrl?: string;  // Bike image
  buildKind?: string;  // 'complete' | 'frameset'
  isFrameset?: boolean;
  isEbike?: boolean;
  gender?: string;  // 'unisex' | 'mens' | 'womens'
  frameMaterial?: string;  // 'carbon' | 'aluminum' | etc.
  hangerStandard?: string;  // 'udh' | etc.
  suspension?: SpokesSuspension;
  components?: SpokesComponents;
}

interface SpokesApiResponse {
  total: number;
  items: SpokesBike[];
  nextCursor?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiting
// ─────────────────────────────────────────────────────────────────────────────

const acquireRequestSlot = async (): Promise<void> => {
  const previousPromise = requestQueuePromise;

  let resolveSlot: () => void = () => {};
  requestQueuePromise = new Promise((resolve) => {
    resolveSlot = resolve;
  });

  await previousPromise;

  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest)
    );
  }

  lastRequestTime = Date.now();
  resolveSlot();
};

// ─────────────────────────────────────────────────────────────────────────────
// Caching Helpers
// ─────────────────────────────────────────────────────────────────────────────

const getCached = async <T>(key: string): Promise<T | undefined> => {
  // Try Redis first
  if (isRedisReady()) {
    try {
      const redis = getRedisConnection();
      const cached = await redis.get(key);
      if (cached) {
        return JSON.parse(cached) as T;
      }
    } catch (error) {
      console.warn('[Spokes] Redis cache read failed:', error);
    }
  }

  // Fallback to memory cache
  const memCached = memoryCache.get(key);
  if (memCached && memCached.expiresAt > Date.now()) {
    return memCached.value as T;
  }

  // Clean up expired entry
  if (memCached) {
    memoryCache.delete(key);
  }

  return undefined;
};

const setCache = async <T>(key: string, value: T, ttlSeconds: number): Promise<void> => {
  const expiresAt = Date.now() + ttlSeconds * 1000;

  // Store in memory cache (with size limit)
  if (memoryCache.size >= MEMORY_CACHE_MAX_SIZE) {
    const firstKey = memoryCache.keys().next().value;
    if (firstKey) memoryCache.delete(firstKey);
  }
  memoryCache.set(key, { value, expiresAt });

  // Store in Redis
  if (isRedisReady()) {
    try {
      const redis = getRedisConnection();
      await redis.setex(key, ttlSeconds, JSON.stringify(value));
    } catch (error) {
      console.warn('[Spokes] Redis cache write failed:', error);
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// API Methods
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Search bikes via 99spokes API.
 * Results are cached for 24 hours.
 */
export async function searchBikes(params: {
  query: string;
  year?: number;
  category?: string;
  limit?: number;
}): Promise<SpokesSearchResult[]> {
  if (!SPOKES_API_KEY) {
    console.error('[Spokes] SPOKES_API_KEY not configured');
    return [];
  }

  const query = params.query.trim();
  if (query.length < 2) {
    return [];
  }

  // Build cache key
  const cacheKey = `spokes:search:${query.toLowerCase()}:${params.year || 'any'}:${params.category || 'all'}`;

  // Check cache
  const cached = await getCached<SpokesSearchResult[]>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    await acquireRequestSlot();

    const url = new URL(`${SPOKES_API_BASE}/bikes`);
    url.searchParams.set('q', query);
    url.searchParams.set('queryMode', 'prefix');
    url.searchParams.set('limit', String(params.limit || 20));

    if (params.year) {
      url.searchParams.set('year', String(params.year));
    }
    if (params.category) {
      url.searchParams.set('category', params.category);
    }

    // Include components for auto-fill (suspension requires higher API tier)
    url.searchParams.set('include', 'components');

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${SPOKES_API_KEY}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[Spokes] Search API error ${response.status}: ${text}`);
      return [];
    }

    const data = (await response.json()) as SpokesApiResponse;

    const results: SpokesSearchResult[] = data.items.map((bike) => ({
      id: bike.id,
      maker: bike.maker,
      model: bike.model,
      year: bike.year,
      family: bike.family,
      category: bike.category,
      subcategory: bike.subcategory,
    }));

    // Cache results
    await setCache(cacheKey, results, SEARCH_CACHE_TTL_SECONDS);

    return results;
  } catch (error) {
    console.error('[Spokes] Search error:', error);
    return [];
  }
}

/**
 * Get full bike details by ID using direct endpoint.
 * Results are cached for 7 days (bike specs rarely change).
 */
export async function getBikeById(id: string): Promise<SpokesBike | null> {
  if (!SPOKES_API_KEY) {
    console.error('[Spokes] SPOKES_API_KEY not configured');
    return null;
  }

  if (!id) {
    return null;
  }

  const cacheKey = `spokes:bike:${id}`;

  // Check cache
  const cached = await getCached<SpokesBike>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    await acquireRequestSlot();

    // Use direct endpoint for full bike details
    const url = `${SPOKES_API_BASE}/bikes/${encodeURIComponent(id)}?include=components`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${SPOKES_API_KEY}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      console.error(`[Spokes] Get bike API error ${response.status}`);
      return null;
    }

    // Direct endpoint returns the bike object directly, not wrapped in items array
    const bike = (await response.json()) as SpokesBike;

    if (!bike || !bike.id) {
      return null;
    }

    // Cache for 7 days
    await setCache(cacheKey, bike, BIKE_CACHE_TTL_SECONDS);

    return bike;
  } catch (error) {
    console.error('[Spokes] Get bike error:', error);
    return null;
  }
}

/**
 * Check if the 99spokes API is configured and available.
 */
export function isSpokesConfigured(): boolean {
  return Boolean(SPOKES_API_KEY);
}
