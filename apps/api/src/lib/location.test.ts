// Mock prisma before importing
const mockGeoCache = {
  findUnique: jest.fn(),
  upsert: jest.fn(),
};

jest.mock('./prisma', () => ({
  prisma: {
    geoCache: mockGeoCache,
  },
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
    expect(deriveLocation({
      city: 'Paris',
      country: 'France',
    })).toBe('Paris');
  });

  it('should return state when no city (state takes priority over state+country)', () => {
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
  beforeEach(() => {
    jest.clearAllMocks();
    mockGeoCache.findUnique.mockResolvedValue(null);
    mockGeoCache.upsert.mockResolvedValue({});
  });

  describe('input validation', () => {
    it('should return null for invalid latitude', async () => {
      const result = await reverseGeocode(91, -104.99);
      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return null for invalid longitude', async () => {
      const result = await reverseGeocode(39.74, 181);
      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return null for NaN coordinates', async () => {
      const result = await reverseGeocode(NaN, -104.99);
      expect(result).toBeNull();
    });
  });

  describe('caching', () => {
    it('should return cached JSON result with preserved quality', async () => {
      // New format: JSON with title and quality
      mockGeoCache.findUnique.mockResolvedValue({
        location: JSON.stringify({ title: 'Denver, CO', quality: 'med' }),
      });

      const result = await reverseGeocode(39.7392, -104.9903);

      expect(result).toEqual({
        title: 'Denver, CO',
        quality: 'med',
        source: 'nominatim',
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return cached legacy plain text with med quality', async () => {
      // Legacy format: plain text (backward compatibility)
      mockGeoCache.findUnique.mockResolvedValue({
        location: 'Legacy Location',
      });

      const result = await reverseGeocode(39.74, -104.99);

      expect(result).toEqual({
        title: 'Legacy Location',
        quality: 'med',
        source: 'nominatim',
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return null for cached null result', async () => {
      mockGeoCache.findUnique.mockResolvedValue({
        location: null,
      });

      // Use different coordinates to avoid in-memory cache hit from previous test
      const result = await reverseGeocode(35.0, -110.0);

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should cache result as JSON with title and quality', async () => {
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

      // Paris without state returns just "Paris" with medium quality, cached as JSON
      expect(mockGeoCache.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            location: JSON.stringify({ title: 'Paris', quality: 'med' }),
          }),
        })
      );
    });

    it('should cache high quality result when POI is present', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          name: 'Test Park',
          category: 'leisure',
          address: {
            city: 'Test City',
            state: 'Colorado',
            country_code: 'us',
          },
        }),
      } as Response);

      await reverseGeocode(40.001, -105.001);

      expect(mockGeoCache.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            location: JSON.stringify({ title: 'Test Park · Test City, CO', quality: 'high' }),
          }),
        })
      );
    });

    it('should cache null result for missing address', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);

      const result = await reverseGeocode(0.001, 0.001);

      expect(result).toBeNull();
      expect(mockGeoCache.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            location: null,
          }),
        })
      );
    });
  });

  describe('RideTitle format', () => {
    it('should return high quality title with trusted POI', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          name: 'Galbraith Mountain Trailhead',
          category: 'leisure',
          type: 'nature_reserve',
          address: {
            city: 'Bellingham',
            state: 'Washington',
            country: 'United States',
            country_code: 'us',
          },
        }),
      } as Response);

      const result = await reverseGeocode(48.7500, -122.4800);

      expect(result).toEqual({
        title: 'Galbraith Mountain Trailhead · Bellingham, WA',
        subtitle: 'Bellingham, WA',
        quality: 'high',
        source: 'nominatim',
      });
    });

    it('should return medium quality title without POI', async () => {
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

      const result = await reverseGeocode(39.7500, -104.9900);

      expect(result).toEqual({
        title: 'Denver, CO',
        subtitle: 'Denver, CO',
        quality: 'med',
        source: 'nominatim',
      });
    });

    it('should ignore highway POI names', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          name: 'Interstate 5',
          category: 'highway',
          address: {
            city: 'Seattle',
            state: 'Washington',
            country_code: 'us',
          },
        }),
      } as Response);

      const result = await reverseGeocode(47.6100, -122.3300);

      // Highway category not in TRUSTED_POI_CATEGORIES, so POI name is ignored
      expect(result?.title).toBe('Seattle, WA');
      expect(result?.quality).toBe('med');
    });

    it('should not duplicate locality in POI title', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          name: 'Seattle',  // POI name same as city
          category: 'leisure',
          address: {
            city: 'Seattle',
            state: 'Washington',
            country_code: 'us',
          },
        }),
      } as Response);

      const result = await reverseGeocode(47.6062, -122.3321);

      // Should not show "Seattle · Seattle, WA"
      expect(result?.title).toBe('Seattle, WA');
    });
  });

  describe('US state abbreviation', () => {
    it('should abbreviate Washington to WA', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          address: {
            city: 'Seattle',
            state: 'Washington',
            country_code: 'us',
          },
        }),
      } as Response);

      const result = await reverseGeocode(47.6, -122.3);

      expect(result?.title).toBe('Seattle, WA');
    });

    it('should abbreviate California to CA', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          address: {
            city: 'San Francisco',
            state: 'California',
            country_code: 'us',
          },
        }),
      } as Response);

      const result = await reverseGeocode(37.7, -122.4);

      expect(result?.title).toBe('San Francisco, CA');
    });

    it('should abbreviate District of Columbia to DC', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          address: {
            city: 'Washington',
            state: 'District of Columbia',
            country_code: 'us',
          },
        }),
      } as Response);

      const result = await reverseGeocode(38.9, -77.0);

      expect(result?.title).toBe('Washington, DC');
    });

    it('should keep full state name for non-US countries', async () => {
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

      expect(result?.title).toBe('Vancouver, British Columbia');
    });
  });

  describe('country code handling', () => {
    it('should convert us to USA', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          address: {
            state: 'Alaska',
            country_code: 'us',
          },
        }),
      } as Response);

      const result = await reverseGeocode(64.0, -150.0);

      expect(result?.title).toBe('AK, USA');
    });

    it('should convert gb to UK', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          address: {
            city: 'London',
            state: 'England',
            country_code: 'gb',
          },
        }),
      } as Response);

      const result = await reverseGeocode(51.5, -0.1);

      expect(result?.title).toBe('London, England');
    });

    it('should uppercase other country codes', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          address: {
            state: 'New South Wales',
            country_code: 'au',
          },
        }),
      } as Response);

      const result = await reverseGeocode(-33.8, 151.2);

      expect(result?.title).toBe('New South Wales, AU');
    });
  });

  describe('locality fallbacks', () => {
    it('should use town when city not available', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          address: {
            town: 'Small Town',
            state: 'Colorado',
            country_code: 'us',
          },
        }),
      } as Response);

      const result = await reverseGeocode(39.5, -105.0);

      expect(result?.title).toBe('Small Town, CO');
    });

    it('should use village when town not available', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          address: {
            village: 'Tiny Village',
            state: 'Vermont',
            country_code: 'us',
          },
        }),
      } as Response);

      const result = await reverseGeocode(44.0, -72.7);

      expect(result?.title).toBe('Tiny Village, VT');
    });

    it('should use hamlet when village not available', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          address: {
            hamlet: 'Remote Hamlet',
            state: 'Montana',
            country_code: 'us',
          },
        }),
      } as Response);

      const result = await reverseGeocode(47.0, -110.0);

      expect(result?.title).toBe('Remote Hamlet, MT');
    });

    it('should use county when no city/town/village/hamlet', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          address: {
            county: 'Whatcom County',
            state: 'Washington',
            country_code: 'us',
          },
        }),
      } as Response);

      const result = await reverseGeocode(48.9, -122.5);

      expect(result?.title).toBe('Whatcom County, WA');
    });
  });

  describe('trusted POI categories', () => {
    it('should include leisure category (parks, trails)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          name: 'Central Park',
          category: 'leisure',
          address: {
            city: 'New York',
            state: 'New York',
            country_code: 'us',
          },
        }),
      } as Response);

      const result = await reverseGeocode(40.7829, -73.9654);

      expect(result?.title).toBe('Central Park · New York, NY');
      expect(result?.quality).toBe('high');
    });

    it('should include tourism category (viewpoints)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          name: 'Grand Canyon Viewpoint',
          category: 'tourism',
          address: {
            state: 'Arizona',
            country_code: 'us',
          },
        }),
      } as Response);

      const result = await reverseGeocode(36.1, -112.1);

      expect(result?.title).toBe('Grand Canyon Viewpoint · AZ, USA');
      expect(result?.quality).toBe('high');
    });

    it('should include natural category (peaks, forests)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          name: 'Mount Rainier',
          category: 'natural',
          address: {
            state: 'Washington',
            country_code: 'us',
          },
        }),
      } as Response);

      const result = await reverseGeocode(46.8523, -121.7603);

      expect(result?.title).toBe('Mount Rainier · WA, USA');
      expect(result?.quality).toBe('high');
    });

    it('should include amenity category (trailhead parking)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          name: 'Tiger Mountain Trailhead Parking',
          category: 'amenity',
          address: {
            city: 'Issaquah',
            state: 'Washington',
            country_code: 'us',
          },
        }),
      } as Response);

      const result = await reverseGeocode(47.4626, -122.0353);

      expect(result?.title).toBe('Tiger Mountain Trailhead Parking · Issaquah, WA');
      expect(result?.quality).toBe('high');
    });
  });

  describe('error handling', () => {
    it('should return null on API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      const result = await reverseGeocode(10.123, 20.456);

      expect(result).toBeNull();
    });

    it('should return null on fetch error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await reverseGeocode(11.111, 22.222);

      expect(result).toBeNull();
    });

    it('should handle DB cache errors gracefully', async () => {
      mockGeoCache.findUnique.mockRejectedValue(new Error('DB error'));
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          address: {
            city: 'Test City',
            state: 'Test State',
            country_code: 'us',
          },
        }),
      } as Response);

      const result = await reverseGeocode(45.0, -90.0);

      // Should still work, just skip cache read
      expect(result?.title).toBe('Test City, Test State');
    });
  });

  describe('coordinate rounding for cache', () => {
    it('should round coordinates to 3 decimal places', async () => {
      mockGeoCache.findUnique.mockResolvedValue({
        location: JSON.stringify({ title: 'Cached Location', quality: 'med' }),
      });

      // Use coordinates unique to this test to avoid in-memory cache hits
      await reverseGeocode(12.34567890, -98.76543210);

      expect(mockGeoCache.findUnique).toHaveBeenCalledWith({
        where: {
          lat_lon: { lat: 12.346, lon: -98.765 },
        },
      });
    });
  });
});

describe('deriveLocationAsync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGeoCache.findUnique.mockResolvedValue(null);
    mockGeoCache.upsert.mockResolvedValue({});
  });

  it('should return RideTitle with sync location when available', async () => {
    const result = await deriveLocationAsync({
      city: 'Denver',
      state: 'Colorado',
    });

    expect(result).toEqual({
      title: 'Denver, Colorado',
      quality: 'med',
      source: 'nominatim',
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should reverse geocode when only lat/lon provided', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        address: {
          city: 'Boulder',
          state: 'Colorado',
          country_code: 'us',
        },
      }),
    } as Response);

    const result = await deriveLocationAsync({
      lat: 40.015,
      lon: -105.2705,
    });

    expect(result).toEqual({
      title: 'Boulder, CO',
      subtitle: 'Boulder, CO',
      quality: 'med',
      source: 'nominatim',
    });
  });

  it('should fall back to lat/lon format with low quality when geocoding fails', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    const result = await deriveLocationAsync({
      lat: 55.555,
      lon: -66.666,
    });

    expect(result).toEqual({
      title: 'Lat 55.555, Lon -66.666',
      quality: 'low',
      source: 'nominatim',
    });
  });

  it('should not reverse geocode when real location exists', async () => {
    const result = await deriveLocationAsync({
      city: 'Existing City',
      lat: 40.015,
      lon: -105.2705,
    });

    expect(result).toEqual({
      title: 'Existing City',
      quality: 'med',
      source: 'nominatim',
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should return null when nothing provided', async () => {
    const result = await deriveLocationAsync({});

    expect(result).toBeNull();
  });
});
