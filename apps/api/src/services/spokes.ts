import crypto from 'crypto';
import { getRedisConnection, isRedisReady } from '../lib/redis';
import { logError } from '../lib/logger';

// API configuration
const SPOKES_API_BASE = 'https://api.99spokes.com/v1';
const SPOKES_API_KEY = process.env.SPOKES_API_KEY ?? '';

/**
 * Validates API key is configured. Throws if not.
 * Routes should check isSpokesConfigured() before calling service functions.
 */
function assertApiKeyConfigured(): void {
  if (!SPOKES_API_KEY) {
    throw new Error('[Spokes] SPOKES_API_KEY is not configured. Check isSpokesConfigured() before calling API methods.');
  }
}

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
  /** Null when 99spokes sends a listing with no model year. Sorts last. */
  year: number | null;
  family: string;
  category: string;
  subcategory: string | null;
  /** Product shot, already paid for by the `include` on the search request. */
  thumbnailUrl: string | null;
  /** 'complete' | 'frameset' when 99spokes reports it on list items. */
  buildKind: string | null;
  /** Resolved frame-only flag. See `isFramesetResult` for how it is derived. */
  isFrameset: boolean;
}

export interface SpokesComponent {
  make?: string;
  maker?: string;  // Some endpoints use 'maker' instead of 'make'
  model?: string;
  description?: string;
  display?: string;  // Display string from API
  kind?: string;  // e.g., 'dropper' for seatpost
  material?: string;  // For fork, handlebar, rims
  innerWidthMM?: number;  // For rims
  width?: string;  // For tires
}

export interface SpokesImage {
  url: string;
  dimensions?: {
    width: number;
    height: number;
  };
  colorKey?: string;
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
  /** Absent on some listings. Nothing validates this payload on arrival. */
  year: number | null;
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
  components?: SpokesComponents;
  images?: SpokesImage[];  // Additional images for fallback
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

/**
 * Sanitizes a string for use in cache keys.
 * Replaces non-alphanumeric characters with underscores and appends a short hash
 * to prevent collisions (e.g., "Santa Cruz" vs "Santa:Cruz" would otherwise both
 * become "Santa_Cruz").
 */
const sanitizeCacheKey = (str: string): string => {
  const hash = crypto.createHash('sha256').update(str).digest('hex').slice(0, 8);
  return str.replace(/[^\w-]/g, '_').slice(0, 100) + '_' + hash;
};

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
// Search result shaping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Model names 99spokes uses for a frame-only listing. The flag below is the
 * primary signal; this is the fallback for when it is missing.
 */
const FRAMESET_NAME_PATTERN = /\bframeset\b|\bframe[\s-]?(only|kit)\b/i;

/**
 * Is this listing a bare frame rather than a complete bike?
 *
 * `isFrameset` / `buildKind` are documented on the 99spokes bike object but are
 * NOT in the `include` list we send with the search request, so list items may
 * arrive without them. Adding them to `include` is unverified against the live
 * API and a rejected `include` value would break search outright, so this reads
 * whichever field is present and falls back to the model name. "Framed" (the
 * brand) does not match: the pattern is word-bounded.
 */
export function isFramesetResult(bike: Pick<SpokesBike, 'model' | 'buildKind' | 'isFrameset'>): boolean {
  if (typeof bike.isFrameset === 'boolean') {
    return bike.isFrameset;
  }
  if (bike.buildKind) {
    return bike.buildKind.toLowerCase() === 'frameset';
  }
  return FRAMESET_NAME_PATTERN.test(bike.model ?? '');
}

/**
 * Map the raw 99spokes items to our search shape, newest model year first.
 *
 * The rider is almost always adding a bike they own now, so a 2026 build should
 * outrank a 2023 one that scored better on the upstream text match. Sort is
 * stable, so upstream relevance still orders bikes within a single year, and
 * anything missing a year sorts last rather than jumping to the top.
 *
 * Framesets are kept here and filtered per-caller, so one cache entry can serve
 * both the onboarding flow (which excludes them) and Add Bike (which does not).
 */
export function normalizeSearchResults(items: SpokesBike[]): SpokesSearchResult[] {
  return items
    .map((bike) => ({
      id: bike.id,
      maker: bike.maker,
      model: bike.model,
      year: bike.year ?? null,
      family: bike.family,
      category: bike.category,
      subcategory: bike.subcategory,
      thumbnailUrl: bike.thumbnailUrl ?? null,
      buildKind: bike.buildKind ?? null,
      isFrameset: isFramesetResult(bike),
    }))
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
}

/** Applied after the cache read so one cached entry serves both callers. */
export function applyFramesetFilter(
  results: SpokesSearchResult[],
  excludeFramesets?: boolean,
): SpokesSearchResult[] {
  return excludeFramesets ? results.filter((bike) => !bike.isFrameset) : results;
}

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
  /**
   * Drop frame-only listings. Onboarding sets this: a frameset carries no fork,
   * drivetrain, brakes or tires from 99spokes, so a rider who picks one lands on
   * a bike with almost nothing to track, and the 'All Stock' step that follows
   * would be describing components that do not exist.
   */
  excludeFramesets?: boolean;
}): Promise<SpokesSearchResult[]> {
  assertApiKeyConfigured();

  const query = params.query.trim();
  if (query.length < 2) {
    return [];
  }

  // Build cache key with sanitized user input. The v2 generation carries
  // thumbnails, the frameset flag and the year sort; v1 entries have none of
  // them and would otherwise keep serving thumbnail-less rows for 24 hours.
  const cacheKey = `spokes:search:v2:${sanitizeCacheKey(query.toLowerCase())}:${params.year || 'any'}:${sanitizeCacheKey(params.category || 'all')}`;

  // The cache holds the unfiltered superset, so the same entry serves callers
  // that want framesets and callers that do not.
  const cached = await getCached<SpokesSearchResult[]>(cacheKey);
  if (cached) {
    return applyFramesetFilter(cached, params.excludeFramesets);
  }

  try {
    await acquireRequestSlot();

    const url = new URL(`${SPOKES_API_BASE}/bikes`);
    url.searchParams.set('q', query);
    url.searchParams.set('queryMode', 'prefix');
    url.searchParams.set('limit', String(params.limit || 20));
    url.searchParams.set('include', 'thumbnailUrl,components');

    if (params.year) {
      url.searchParams.set('year', String(params.year));
    }
    if (params.category) {
      url.searchParams.set('category', params.category);
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${SPOKES_API_KEY}`,
        Accept: 'application/json',
        'User-Agent': 'LoamLogger/1.0',
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[Spokes] Search API error ${response.status}: ${text}`);
      return [];
    }

    const data = (await response.json()) as SpokesApiResponse;

    const results = normalizeSearchResults(data.items);

    // Cache results
    await setCache(cacheKey, results, SEARCH_CACHE_TTL_SECONDS);

    return applyFramesetFilter(results, params.excludeFramesets);
  } catch (error) {
    logError('Spokes Search', error);
    return [];
  }
}

/**
 * Get full bike details by ID using direct endpoint.
 * Results are cached for 7 days (bike specs rarely change).
 */
export async function getBikeById(id: string): Promise<SpokesBike | null> {
  assertApiKeyConfigured();

  if (!id) {
    return null;
  }

  const cacheKey = `spokes:bike:${sanitizeCacheKey(id)}`;

  // Check cache
  const cached = await getCached<SpokesBike>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    await acquireRequestSlot();

    // Use direct endpoint for full bike details
    const url = new URL(`${SPOKES_API_BASE}/bikes/${id}`);
    url.searchParams.set('include', 'thumbnailUrl,components,images');

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${SPOKES_API_KEY}`,
        Accept: 'application/json',
        'User-Agent': 'LoamLogger/1.0',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      const errorBody = await response.text().catch(() => '');
      console.error(`[Spokes] Get bike API error ${response.status}: ${errorBody}`);
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
    logError('Spokes Get bike', error);
    return null;
  }
}

/**
 * Check if the 99spokes API is configured and available.
 */
export function isSpokesConfigured(): boolean {
  return Boolean(SPOKES_API_KEY);
}
