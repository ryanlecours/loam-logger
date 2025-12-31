// Mock redis before importing cache
jest.mock('../../../lib/redis', () => ({
  isRedisReady: jest.fn(),
  getRedisConnection: jest.fn(),
}));

import { isRedisReady, getRedisConnection } from '../../../lib/redis';
import {
  buildCacheKey,
  getCachedPrediction,
  setCachedPrediction,
  invalidateBikePrediction,
  invalidateUserPredictions,
  clearMemoryCache,
  getMemoryCacheSize,
} from '../cache';
import type { BikePredictionSummary } from '../types';

describe('prediction cache', () => {
  const mockPrediction: BikePredictionSummary = {
    bikeId: 'bike-123',
    bikeName: 'Test Bike',
    components: [],
    priorityComponent: null,
    overallStatus: 'ALL_GOOD',
    dueNowCount: 0,
    dueSoonCount: 1,
    generatedAt: new Date('2024-01-15T10:00:00Z'),
    algoVersion: 'v1',
  };

  const cacheParams = {
    userId: 'user-123',
    bikeId: 'bike-123',
    algoVersion: 'v1',
    planTier: 'PRO' as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    clearMemoryCache();
  });

  describe('buildCacheKey', () => {
    it('should build correct cache key format', () => {
      const key = buildCacheKey(cacheParams);
      expect(key).toBe('pred:v1:user:user-123:bike:bike-123:tier:PRO');
    });

    it('should differentiate FREE and PRO keys', () => {
      const proKey = buildCacheKey({ ...cacheParams, planTier: 'PRO' });
      const freeKey = buildCacheKey({ ...cacheParams, planTier: 'FREE' });

      expect(proKey).not.toBe(freeKey);
      expect(proKey).toContain(':tier:PRO');
      expect(freeKey).toContain(':tier:FREE');
    });
  });

  describe('getCachedPrediction', () => {
    it('should return null when no cache exists', async () => {
      (isRedisReady as jest.Mock).mockReturnValue(false);

      const result = await getCachedPrediction(cacheParams);
      expect(result).toBeNull();
    });

    it('should return cached value from memory', async () => {
      (isRedisReady as jest.Mock).mockReturnValue(false);

      // Set in memory cache
      await setCachedPrediction(cacheParams, mockPrediction);

      const result = await getCachedPrediction(cacheParams);
      expect(result).not.toBeNull();
      expect(result?.bikeId).toBe('bike-123');
    });

    it('should try Redis first when available', async () => {
      const mockRedis = {
        get: jest.fn().mockResolvedValue(JSON.stringify(mockPrediction)),
      };
      (isRedisReady as jest.Mock).mockReturnValue(true);
      (getRedisConnection as jest.Mock).mockReturnValue(mockRedis);

      const result = await getCachedPrediction(cacheParams);

      expect(mockRedis.get).toHaveBeenCalled();
      expect(result).not.toBeNull();
      expect(result?.bikeId).toBe('bike-123');
    });

    it('should fallback to memory when Redis fails', async () => {
      const mockRedis = {
        get: jest.fn().mockRejectedValue(new Error('Redis error')),
      };
      (isRedisReady as jest.Mock).mockReturnValue(true);
      (getRedisConnection as jest.Mock).mockReturnValue(mockRedis);

      // Set in memory cache first
      await setCachedPrediction(cacheParams, mockPrediction);

      // Reset mock to fail on get
      mockRedis.get.mockRejectedValue(new Error('Redis error'));

      const result = await getCachedPrediction(cacheParams);
      expect(result).not.toBeNull();
    });

    it('should rehydrate Date objects', async () => {
      (isRedisReady as jest.Mock).mockReturnValue(false);

      await setCachedPrediction(cacheParams, mockPrediction);
      const result = await getCachedPrediction(cacheParams);

      expect(result?.generatedAt).toBeInstanceOf(Date);
    });
  });

  describe('setCachedPrediction', () => {
    it('should store in memory cache', async () => {
      (isRedisReady as jest.Mock).mockReturnValue(false);

      expect(getMemoryCacheSize()).toBe(0);
      await setCachedPrediction(cacheParams, mockPrediction);
      expect(getMemoryCacheSize()).toBe(1);
    });

    it('should store in Redis when available', async () => {
      const mockRedis = {
        setex: jest.fn().mockResolvedValue('OK'),
      };
      (isRedisReady as jest.Mock).mockReturnValue(true);
      (getRedisConnection as jest.Mock).mockReturnValue(mockRedis);

      await setCachedPrediction(cacheParams, mockPrediction, 1800);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        expect.any(String),
        1800,
        expect.any(String)
      );
    });

    it('should evict oldest entry when memory cache is full', async () => {
      (isRedisReady as jest.Mock).mockReturnValue(false);

      // Fill cache with 100 entries
      for (let i = 0; i < 100; i++) {
        await setCachedPrediction(
          { ...cacheParams, bikeId: `bike-${i}` },
          { ...mockPrediction, bikeId: `bike-${i}` }
        );
      }

      expect(getMemoryCacheSize()).toBe(100);

      // Add one more
      await setCachedPrediction(
        { ...cacheParams, bikeId: 'bike-new' },
        { ...mockPrediction, bikeId: 'bike-new' }
      );

      // Should still be 100 (oldest evicted)
      expect(getMemoryCacheSize()).toBe(100);
    });
  });

  describe('invalidateBikePrediction', () => {
    it('should clear memory cache entries for bike', async () => {
      (isRedisReady as jest.Mock).mockReturnValue(false);

      // Add entries for different tiers
      await setCachedPrediction(
        { ...cacheParams, planTier: 'PRO' },
        mockPrediction
      );
      await setCachedPrediction(
        { ...cacheParams, planTier: 'FREE' },
        mockPrediction
      );
      await setCachedPrediction(
        { ...cacheParams, bikeId: 'other-bike' },
        { ...mockPrediction, bikeId: 'other-bike' }
      );

      expect(getMemoryCacheSize()).toBe(3);

      await invalidateBikePrediction('user-123', 'bike-123');

      // Only other-bike should remain
      expect(getMemoryCacheSize()).toBe(1);
    });

    it('should clear Redis entries when available', async () => {
      const mockRedis = {
        scan: jest.fn().mockResolvedValue(['0', ['key1', 'key2']]),
        del: jest.fn().mockResolvedValue(2),
      };
      (isRedisReady as jest.Mock).mockReturnValue(true);
      (getRedisConnection as jest.Mock).mockReturnValue(mockRedis);

      await invalidateBikePrediction('user-123', 'bike-123');

      expect(mockRedis.scan).toHaveBeenCalledWith(
        '0',
        'MATCH',
        expect.stringContaining('bike:bike-123'),
        'COUNT',
        100
      );
      expect(mockRedis.del).toHaveBeenCalledWith('key1', 'key2');
    });
  });

  describe('invalidateUserPredictions', () => {
    it('should clear all cache entries for user', async () => {
      (isRedisReady as jest.Mock).mockReturnValue(false);

      // Add entries for different bikes
      await setCachedPrediction(
        { ...cacheParams, bikeId: 'bike-1' },
        { ...mockPrediction, bikeId: 'bike-1' }
      );
      await setCachedPrediction(
        { ...cacheParams, bikeId: 'bike-2' },
        { ...mockPrediction, bikeId: 'bike-2' }
      );
      await setCachedPrediction(
        { ...cacheParams, userId: 'other-user', bikeId: 'bike-3' },
        { ...mockPrediction, bikeId: 'bike-3' }
      );

      expect(getMemoryCacheSize()).toBe(3);

      await invalidateUserPredictions('user-123');

      // Only other-user's entry should remain
      expect(getMemoryCacheSize()).toBe(1);
    });
  });
});
