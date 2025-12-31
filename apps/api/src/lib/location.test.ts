// Mock redis before importing
jest.mock('./redis', () => ({
  isRedisReady: jest.fn(),
  getRedisConnection: jest.fn(),
}));

// Mock global fetch
global.fetch = jest.fn();

import {
  reverseGeocode,
  buildLocationString,
  formatLatLon,
  deriveLocation,
  deriveLocationAsync,
  shouldApplyAutoLocation,
} from './location';
import { isRedisReady, getRedisConnection } from './redis';

const mockIsRedisReady = isRedisReady as jest.MockedFunction<typeof isRedisReady>;
const mockGetRedisConnection = getRedisConnection as jest.MockedFunction<typeof getRedisConnection>;
const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

describe('buildLocationString', () => {
  it('should join non-empty parts with commas', () => {
    expect(buildLocationString(['Denver', 'Colorado', 'USA'])).toBe('Denver, Colorado, USA');
  });

  it('should filter out null and undefined values', () => {
    expect(buildLocationString(['Denver', null, 'USA'])).toBe('Denver, USA');
    expect(buildLocationString([null, 'Colorado', undefined])).toBe('Colorado');
  });

  it('should filter out empty strings', () => {
    expect(buildLocationString(['Denver', '', 'USA'])).toBe('Denver, USA');
    expect(buildLocationString(['', '  ', 'USA'])).toBe('USA');
  });

  it('should return null for empty array', () => {
    expect(buildLocationString([])).toBeNull();
  });

  it('should return null when all parts are empty/null', () => {
    expect(buildLocationString([null, undefined, '', '  '])).toBeNull();
  });

  it('should trim whitespace from parts', () => {
    expect(buildLocationString(['  Denver  ', ' Colorado '])).toBe('Denver, Colorado');
  });
});

describe('formatLatLon', () => {
  it('should format valid coordinates', () => {
    expect(formatLatLon(39.7392, -104.9903)).toBe('Lat 39.739, Lon -104.990');
  });

  it('should round to 3 decimal places', () => {
    expect(formatLatLon(39.73921234, -104.99034567)).toBe('Lat 39.739, Lon -104.990');
  });

  it('should return null for null lat', () => {
    expect(formatLatLon(null, -104.99)).toBeNull();
  });

  it('should return null for null lon', () => {
    expect(formatLatLon(39.74, null)).toBeNull();
  });

  it('should return null for undefined values', () => {
    expect(formatLatLon(undefined, undefined)).toBeNull();
    expect(formatLatLon(39.74, undefined)).toBeNull();
  });

  it('should return null for NaN values', () => {
    expect(formatLatLon(NaN, -104.99)).toBeNull();
    expect(formatLatLon(39.74, NaN)).toBeNull();
  });

  it('should handle zero coordinates', () => {
    expect(formatLatLon(0, 0)).toBe('Lat 0.000, Lon 0.000');
  });

  it('should handle negative coordinates', () => {
    expect(formatLatLon(-33.8688, 151.2093)).toBe('Lat -33.869, Lon 151.209');
  });
});

describe('deriveLocation', () => {
  it('should prefer city + state combination', () => {
    expect(deriveLocation({
      city: 'Denver',
      state: 'Colorado',
      country: 'USA',
    })).toBe('Denver, Colorado');
  });

  it('should return city when no state (city takes priority)', () => {
    // buildLocationString returns single value if only one part exists
    // So city+state with only city returns 'Paris', and we never get to city+country
    expect(deriveLocation({
      city: 'Paris',
      country: 'France',
    })).toBe('Paris');
  });

  it('should return state when no city (state takes priority over state+country)', () => {
    // buildLocationString returns single value, so city+state with no city returns null
    // city+country with no city returns null, but state+country with only state returns 'Bavaria'
    // Actually wait - buildLocationString([null, state]) would filter null and return 'Bavaria'
    // So the first non-null match is city+state -> buildLocationString([null, 'Bavaria']) -> 'Bavaria'
    expect(deriveLocation({
      state: 'Bavaria',
      country: 'Germany',
    })).toBe('Bavaria');
  });

  it('should return single value when only one field provided', () => {
    expect(deriveLocation({ city: 'Tokyo' })).toBe('Tokyo');
    expect(deriveLocation({ state: 'California' })).toBe('California');
    expect(deriveLocation({ country: 'Australia' })).toBe('Australia');
  });

  it('should use fallback when no location fields', () => {
    expect(deriveLocation({ fallback: 'Unknown Location' })).toBe('Unknown Location');
  });

  it('should format lat/lon as last resort', () => {
    expect(deriveLocation({ lat: 39.7392, lon: -104.9903 })).toBe('Lat 39.739, Lon -104.990');
  });

  it('should return null when nothing provided', () => {
    expect(deriveLocation({})).toBeNull();
  });

  it('should skip empty strings in single value selection', () => {
    expect(deriveLocation({ city: '', state: 'Colorado' })).toBe('Colorado');
  });
});

describe('shouldApplyAutoLocation', () => {
  it('should return incoming when existing is null', () => {
    expect(shouldApplyAutoLocation(null, 'New Location')).toBe('New Location');
  });

  it('should return incoming when existing is undefined', () => {
    expect(shouldApplyAutoLocation(undefined, 'New Location')).toBe('New Location');
  });

  it('should return incoming when existing is empty string', () => {
    expect(shouldApplyAutoLocation('', 'New Location')).toBe('New Location');
    expect(shouldApplyAutoLocation('   ', 'New Location')).toBe('New Location');
  });

  it('should return undefined when existing has value', () => {
    expect(shouldApplyAutoLocation('Existing Location', 'New Location')).toBeUndefined();
  });

  it('should return undefined when incoming is null', () => {
    expect(shouldApplyAutoLocation(null, null)).toBeUndefined();
  });
});

describe('reverseGeocode', () => {
  let mockRedis: {
    get: jest.Mock;
    setex: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis = {
      get: jest.fn(),
      setex: jest.fn(),
    };
    mockGetRedisConnection.mockReturnValue(mockRedis as never);
    mockIsRedisReady.mockReturnValue(true);
  });

  it('should return cached result from Redis', async () => {
    mockRedis.get.mockResolvedValue('Denver, Colorado, USA');

    const result = await reverseGeocode(39.7392, -104.9903);

    expect(result).toBe('Denver, Colorado, USA');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should return null for cached null result', async () => {
    mockRedis.get.mockResolvedValue('__NULL__');

    const result = await reverseGeocode(39.7392, -104.9903);

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should fetch from Nominatim when not cached', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        address: {
          city: 'Denver',
          state: 'Colorado',
          country: 'United States',
          country_code: 'us',
        },
      }),
    } as Response);

    const result = await reverseGeocode(39.7392, -104.9903);

    expect(result).toBe('Denver, Colorado, USA');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('nominatim.openstreetmap.org/reverse'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': 'LoamLogger/1.0 (ryan.lecours@loamlogger.app)',
        }),
      })
    );
  });

  it('should cache successful result in Redis', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        address: {
          city: 'Paris',
          country: 'France',
          country_code: 'fr',
        },
      }),
    } as Response);

    await reverseGeocode(48.8566, 2.3522);

    // City + country without state produces "Paris, FR" (country is shortened)
    expect(mockRedis.setex).toHaveBeenCalledWith(
      expect.stringContaining('geocode:'),
      expect.any(Number),
      'Paris, FR'
    );
  });

  it('should cache null result for missing address', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}), // No address field
    } as Response);

    const result = await reverseGeocode(0, 0);

    expect(result).toBeNull();
    expect(mockRedis.setex).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Number),
      '__NULL__'
    );
  });

  it('should return null on API error', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    // Use unique coordinates to avoid cache hits from previous tests
    const result = await reverseGeocode(10.123, 20.456);

    expect(result).toBeNull();
  });

  it('should return null on fetch error', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockFetch.mockRejectedValue(new Error('Network error'));

    // Use unique coordinates to avoid cache hits from previous tests
    const result = await reverseGeocode(11.111, 22.222);

    expect(result).toBeNull();
  });

  it('should shorten country names', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        address: {
          city: 'Vancouver',
          state: 'British Columbia',
          country: 'Canada',
          country_code: 'ca',
        },
      }),
    } as Response);

    const result = await reverseGeocode(49.2827, -123.1207);

    expect(result).toBe('Vancouver, British Columbia, CA');
  });

  it('should use town when city not available', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        address: {
          town: 'Small Town',
          state: 'Colorado',
          country: 'United States',
          country_code: 'us',
        },
      }),
    } as Response);

    const result = await reverseGeocode(39.5, -105.0);

    expect(result).toBe('Small Town, Colorado, USA');
  });

  it('should use village when town not available', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        address: {
          village: 'Tiny Village',
          country: 'United Kingdom',
          country_code: 'gb',
        },
      }),
    } as Response);

    const result = await reverseGeocode(51.5, -0.1);

    expect(result).toBe('Tiny Village, UK');
  });

  it('should work when Redis is unavailable', async () => {
    mockIsRedisReady.mockReturnValue(false);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        address: {
          city: 'Tokyo',
          country: 'Japan',
          country_code: 'jp',
        },
      }),
    } as Response);

    const result = await reverseGeocode(35.6762, 139.6503);

    expect(result).toBe('Tokyo, JP');
    expect(mockRedis.get).not.toHaveBeenCalled();
  });

  it('should round coordinates for cache key', async () => {
    mockRedis.get.mockResolvedValue('Cached Location');

    await reverseGeocode(39.73921234, -104.99034567);

    expect(mockRedis.get).toHaveBeenCalledWith('geocode:39.739:-104.990');
  });
});

describe('deriveLocationAsync', () => {
  let mockRedis: {
    get: jest.Mock;
    setex: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis = {
      get: jest.fn(),
      setex: jest.fn(),
    };
    mockGetRedisConnection.mockReturnValue(mockRedis as never);
    mockIsRedisReady.mockReturnValue(true);
  });

  it('should return sync location when available', async () => {
    const result = await deriveLocationAsync({
      city: 'Denver',
      state: 'Colorado',
    });

    expect(result).toBe('Denver, Colorado');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should reverse geocode when only lat/lon provided', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        address: {
          city: 'Boulder',
          state: 'Colorado',
          country: 'United States',
          country_code: 'us',
        },
      }),
    } as Response);

    const result = await deriveLocationAsync({
      lat: 40.015,
      lon: -105.2705,
    });

    expect(result).toBe('Boulder, Colorado, USA');
  });

  it('should fall back to lat/lon format when geocoding fails', async () => {
    mockRedis.get.mockResolvedValue(null);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    // Use unique coordinates to avoid cache hits
    const result = await deriveLocationAsync({
      lat: 55.555,
      lon: -66.666,
    });

    expect(result).toBe('Lat 55.555, Lon -66.666');
  });

  it('should not reverse geocode when real location exists', async () => {
    const result = await deriveLocationAsync({
      city: 'Existing City',
      lat: 40.015,
      lon: -105.2705,
    });

    expect(result).toBe('Existing City');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
