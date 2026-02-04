// Mock prisma before importing engine
jest.mock('../../../lib/prisma', () => ({
  prisma: {
    bike: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    ride: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    serviceLog: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    component: {
      findMany: jest.fn(),
    },
    userServicePreference: {
      findMany: jest.fn(),
    },
    bikeServicePreference: {
      findMany: jest.fn(),
    },
  },
}));

// Mock redis
import * as redisModule from '../../../lib/redis';
jest.mock('../../../lib/redis', () => ({
  isRedisReady: jest.fn().mockReturnValue(false),
  getRedisConnection: jest.fn(),
}));

import { prisma } from '../../../lib/prisma';
import { generateBikePredictions } from '../engine';
import { clearMemoryCache } from '../cache';
import type { RideMetrics } from '../types';

const mockIsRedisReady = redisModule.isRedisReady as jest.MockedFunction<typeof redisModule.isRedisReady>;

describe('prediction engine', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    clearMemoryCache();
    // Re-set the default return value for isRedisReady after reset
    mockIsRedisReady.mockReturnValue(false);
    // Default: no service preferences set (all components enabled with default intervals)
    (prisma.userServicePreference as unknown as { findMany: jest.Mock }).findMany.mockResolvedValue([]);
    (prisma.bikeServicePreference as unknown as { findMany: jest.Mock }).findMany.mockResolvedValue([]);
  });

  const mockBike = {
    id: 'bike-123',
    userId: 'user-123',
    nickname: 'Trail Slayer',
    manufacturer: 'Trek',
    model: 'Slash 9.9',
    createdAt: new Date('2019-01-01'),
    components: [
      {
        id: 'comp-chain',
        type: 'CHAIN',
        location: 'NONE',
        brand: 'SRAM',
        model: 'XX1',
        hoursUsed: 50,
        serviceDueAtHours: null,
      },
      {
        id: 'comp-fork',
        type: 'FORK',
        location: 'NONE',
        brand: 'Fox',
        model: '36',
        hoursUsed: 30,
        serviceDueAtHours: 50,
      },
    ],
  };

  const mockRides: RideMetrics[] = [
    {
      durationSeconds: 3600,
      distanceMiles: 10,
      elevationGainFeet: 1500,
      startTime: new Date('2024-01-15'),
    },
    {
      durationSeconds: 7200,
      distanceMiles: 20,
      elevationGainFeet: 3000,
      startTime: new Date('2024-01-14'),
    },
  ];

  describe('generateBikePredictions', () => {
    it('should generate predictions for all trackable components', async () => {
      (prisma.bike.findUnique as jest.Mock).mockResolvedValue(mockBike);
      (prisma.ride.findMany as jest.Mock).mockResolvedValue(mockRides);
      (prisma.ride.findFirst as jest.Mock).mockResolvedValue({
        startTime: new Date('2024-01-01'),
      });
      (prisma.serviceLog.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.serviceLog.findMany as jest.Mock).mockResolvedValue([]);

      const result = await generateBikePredictions({
        userId: 'user-123',
        bikeId: 'bike-123',
        userRole: 'FREE',
      });

      expect(result.bikeId).toBe('bike-123');
      expect(result.bikeName).toBe('Trail Slayer');
      expect(result.components).toHaveLength(2);
      expect(result.algoVersion).toBe('v1');
    });

    it('should throw for unauthorized bike access', async () => {
      (prisma.bike.findUnique as jest.Mock).mockResolvedValue({
        ...mockBike,
        userId: 'other-user',
      });

      await expect(
        generateBikePredictions({
          userId: 'user-123',
          bikeId: 'bike-123',
          userRole: 'FREE',
        })
      ).rejects.toThrow('Not found');
    });

    it('should throw for non-existent bike', async () => {
      (prisma.bike.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        generateBikePredictions({
          userId: 'user-123',
          bikeId: 'bike-123',
          userRole: 'FREE',
        })
      ).rejects.toThrow('Not found');
    });
  });

  describe('status determination', () => {
    it('should return OVERDUE when hoursRemaining <= 0', async () => {
      const overdueComponent = {
        ...mockBike.components[0],
        type: 'CHAIN',
        hoursUsed: 100, // Way over the 70h default for CHAIN
      };

      // Rides that total way more than 70h (CHAIN service interval)
      // Note: sanitizeRideMetrics caps each ride at 24 hours, so we need multiple rides
      const overdueRides: RideMetrics[] = [
        {
          durationSeconds: 24 * 3600, // 24 hours (max per ride)
          distanceMiles: 50,
          elevationGainFeet: 5000,
          startTime: new Date('2024-01-10'),
        },
        {
          durationSeconds: 24 * 3600, // 24 hours
          distanceMiles: 50,
          elevationGainFeet: 5000,
          startTime: new Date('2024-01-09'),
        },
        {
          durationSeconds: 24 * 3600, // 24 hours
          distanceMiles: 50,
          elevationGainFeet: 5000,
          startTime: new Date('2024-01-08'),
        },
        {
          durationSeconds: 10 * 3600, // 10 hours - total: 82 hours > 70h interval
          distanceMiles: 20,
          elevationGainFeet: 2000,
          startTime: new Date('2024-01-07'),
        },
      ];

      (prisma.bike.findUnique as jest.Mock).mockResolvedValue({
        ...mockBike,
        components: [overdueComponent],
      });
      (prisma.ride.findMany as jest.Mock).mockResolvedValue(overdueRides);
      (prisma.serviceLog.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.serviceLog.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.ride.findFirst as jest.Mock).mockResolvedValue({
        startTime: new Date('2020-01-01'),
      });

      const result = await generateBikePredictions({
        userId: 'user-123',
        bikeId: 'bike-123',
        userRole: 'FREE',
      });

      expect(result.components[0].status).toBe('OVERDUE');
      expect(result.overallStatus).toBe('OVERDUE');
    });

    it('should return ALL_GOOD when plenty of hours remaining', async () => {
      const freshComponent = {
        ...mockBike.components[0],
        hoursUsed: 5, // Well under the 70h default for CHAIN
      };

      (prisma.bike.findUnique as jest.Mock).mockResolvedValue({
        ...mockBike,
        components: [freshComponent],
      });
      (prisma.ride.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.serviceLog.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.serviceLog.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.ride.findFirst as jest.Mock).mockResolvedValue({
        startTime: new Date('2024-01-01'),
      });

      const result = await generateBikePredictions({
        userId: 'user-123',
        bikeId: 'bike-123',
        userRole: 'FREE',
      });

      expect(result.components[0].status).toBe('ALL_GOOD');
    });
  });

  describe('FREE vs PRO tier', () => {
    it('should use deterministic calculation for FREE tier', async () => {
      (prisma.bike.findUnique as jest.Mock).mockResolvedValue(mockBike);
      (prisma.ride.findMany as jest.Mock).mockResolvedValue(mockRides);
      (prisma.serviceLog.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.serviceLog.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.ride.findFirst as jest.Mock).mockResolvedValue({
        startTime: new Date('2024-01-01'),
      });

      const result = await generateBikePredictions({
        userId: 'user-123',
        bikeId: 'bike-123',
        userRole: 'FREE',
      });

      // FREE tier should NOT have why/drivers
      expect(result.components[0].why).toBeNull();
      expect(result.components[0].drivers).toBeNull();
    });

    it('should include explanation for PRO tier', async () => {
      (prisma.bike.findUnique as jest.Mock).mockResolvedValue(mockBike);
      (prisma.ride.findMany as jest.Mock).mockResolvedValue(mockRides);
      (prisma.serviceLog.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.serviceLog.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.ride.findFirst as jest.Mock).mockResolvedValue({
        startTime: new Date('2024-01-01'),
      });

      const result = await generateBikePredictions({
        userId: 'user-123',
        bikeId: 'bike-123',
        userRole: 'PRO',
      });

      // PRO tier SHOULD have why/drivers
      expect(result.components[0].why).not.toBeNull();
      expect(result.components[0].drivers).not.toBeNull();
    });

    it('should treat ADMIN as PRO tier', async () => {
      (prisma.bike.findUnique as jest.Mock).mockResolvedValue(mockBike);
      (prisma.ride.findMany as jest.Mock).mockResolvedValue(mockRides);
      (prisma.serviceLog.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.serviceLog.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.ride.findFirst as jest.Mock).mockResolvedValue({
        startTime: new Date('2024-01-01'),
      });

      const result = await generateBikePredictions({
        userId: 'user-123',
        bikeId: 'bike-123',
        userRole: 'ADMIN',
      });

      // ADMIN should be treated as PRO
      expect(result.components[0].why).not.toBeNull();
    });
  });

  describe('priority component', () => {
    it('should identify most urgent component as priority', async () => {
      const components = [
        {
          id: 'comp-1',
          type: 'CHAIN',
          location: 'NONE',
          brand: 'SRAM',
          model: 'XX1',
          hoursUsed: 10, // Plenty of time left
          serviceDueAtHours: null,
        },
        {
          id: 'comp-2',
          type: 'FORK',
          location: 'NONE',
          brand: 'Fox',
          model: '36',
          hoursUsed: 48, // Only 2h left (50h interval)
          serviceDueAtHours: 50,
        },
      ];

      (prisma.bike.findUnique as jest.Mock).mockResolvedValue({
        ...mockBike,
        components,
      });
      (prisma.ride.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.serviceLog.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.serviceLog.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.ride.findFirst as jest.Mock).mockResolvedValue({
        startTime: new Date('2024-01-01'),
      });

      const result = await generateBikePredictions({
        userId: 'user-123',
        bikeId: 'bike-123',
        userRole: 'FREE',
      });

      // Fork should be priority (DUE_NOW with 2h remaining)
      expect(result.priorityComponent?.componentId).toBe('comp-2');
    });
  });

  describe('confidence levels', () => {
    it('should return LOW confidence with few rides', async () => {
      (prisma.bike.findUnique as jest.Mock).mockResolvedValue(mockBike);
      (prisma.ride.findMany as jest.Mock).mockResolvedValue([mockRides[0]]); // Only 1 ride
      (prisma.serviceLog.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.serviceLog.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.ride.findFirst as jest.Mock).mockResolvedValue({
        startTime: new Date('2024-01-01'),
      });

      const result = await generateBikePredictions({
        userId: 'user-123',
        bikeId: 'bike-123',
        userRole: 'FREE',
      });

      expect(result.components[0].confidence).toBe('LOW');
    });
  });

  describe('service preferences', () => {
    beforeEach(() => {
      // Default: no preferences set
      (prisma.userServicePreference as unknown as { findMany: jest.Mock }).findMany.mockResolvedValue([]);
      (prisma.bikeServicePreference as unknown as { findMany: jest.Mock }).findMany.mockResolvedValue([]);
    });

    it('should exclude components when global user preference disables tracking', async () => {
      // User has disabled CHAIN tracking globally
      (prisma.userServicePreference as unknown as { findMany: jest.Mock }).findMany.mockResolvedValue([
        { componentType: 'CHAIN', trackingEnabled: false, customInterval: null },
      ]);

      (prisma.bike.findUnique as jest.Mock).mockResolvedValue(mockBike);
      (prisma.ride.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.serviceLog.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.ride.findFirst as jest.Mock).mockResolvedValue({
        startTime: new Date('2024-01-01'),
      });

      const result = await generateBikePredictions({
        userId: 'user-123',
        bikeId: 'bike-123',
        userRole: 'FREE',
      });

      // CHAIN should be excluded, only FORK should remain
      expect(result.components).toHaveLength(1);
      expect(result.components[0].componentType).toBe('FORK');
    });

    it('should use custom interval from global user preference', async () => {
      // User has set custom interval for FORK
      (prisma.userServicePreference as unknown as { findMany: jest.Mock }).findMany.mockResolvedValue([
        { componentType: 'FORK', trackingEnabled: true, customInterval: 100 }, // Custom: 100h instead of default 50h
      ]);

      const forkOnlyBike = {
        ...mockBike,
        components: [mockBike.components[1]], // Just the fork (no serviceDueAtHours override)
      };
      // Remove the component-level override
      forkOnlyBike.components[0] = { ...forkOnlyBike.components[0], serviceDueAtHours: null };

      (prisma.bike.findUnique as jest.Mock).mockResolvedValue(forkOnlyBike);
      (prisma.ride.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.serviceLog.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.ride.findFirst as jest.Mock).mockResolvedValue({
        startTime: new Date('2024-01-01'),
      });

      const result = await generateBikePredictions({
        userId: 'user-123',
        bikeId: 'bike-123',
        userRole: 'FREE',
      });

      // Service interval should be the custom 100h
      expect(result.components[0].serviceIntervalHours).toBe(100);
    });

    it('should override global preference with bike-specific preference', async () => {
      // Global: CHAIN tracking disabled
      (prisma.userServicePreference as unknown as { findMany: jest.Mock }).findMany.mockResolvedValue([
        { componentType: 'CHAIN', trackingEnabled: false, customInterval: null },
      ]);

      // Bike override: CHAIN tracking enabled for this bike
      (prisma.bikeServicePreference as unknown as { findMany: jest.Mock }).findMany.mockResolvedValue([
        { componentType: 'CHAIN', trackingEnabled: true, customInterval: null },
      ]);

      (prisma.bike.findUnique as jest.Mock).mockResolvedValue(mockBike);
      (prisma.ride.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.serviceLog.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.ride.findFirst as jest.Mock).mockResolvedValue({
        startTime: new Date('2024-01-01'),
      });

      const result = await generateBikePredictions({
        userId: 'user-123',
        bikeId: 'bike-123',
        userRole: 'FREE',
      });

      // CHAIN should be included because bike override enables it
      expect(result.components).toHaveLength(2);
      const chainComponent = result.components.find(c => c.componentType === 'CHAIN');
      expect(chainComponent).toBeDefined();
    });

    it('should use bike-specific custom interval over global custom interval', async () => {
      // Global: CHAIN with 50h custom interval
      (prisma.userServicePreference as unknown as { findMany: jest.Mock }).findMany.mockResolvedValue([
        { componentType: 'CHAIN', trackingEnabled: true, customInterval: 50 },
      ]);

      // Bike override: CHAIN with 30h custom interval
      (prisma.bikeServicePreference as unknown as { findMany: jest.Mock }).findMany.mockResolvedValue([
        { componentType: 'CHAIN', trackingEnabled: true, customInterval: 30 },
      ]);

      const chainOnlyBike = {
        ...mockBike,
        components: [mockBike.components[0]], // Just the chain
      };

      (prisma.bike.findUnique as jest.Mock).mockResolvedValue(chainOnlyBike);
      (prisma.ride.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.serviceLog.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.ride.findFirst as jest.Mock).mockResolvedValue({
        startTime: new Date('2024-01-01'),
      });

      const result = await generateBikePredictions({
        userId: 'user-123',
        bikeId: 'bike-123',
        userRole: 'FREE',
      });

      // Service interval should be the bike-specific 30h, not global 50h
      expect(result.components[0].serviceIntervalHours).toBe(30);
    });

    it('should disable tracking when bike preference disables but global enables', async () => {
      // Global: FORK tracking enabled
      (prisma.userServicePreference as unknown as { findMany: jest.Mock }).findMany.mockResolvedValue([
        { componentType: 'FORK', trackingEnabled: true, customInterval: null },
      ]);

      // Bike override: FORK tracking disabled for this bike
      (prisma.bikeServicePreference as unknown as { findMany: jest.Mock }).findMany.mockResolvedValue([
        { componentType: 'FORK', trackingEnabled: false, customInterval: null },
      ]);

      (prisma.bike.findUnique as jest.Mock).mockResolvedValue(mockBike);
      (prisma.ride.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.serviceLog.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.ride.findFirst as jest.Mock).mockResolvedValue({
        startTime: new Date('2024-01-01'),
      });

      const result = await generateBikePredictions({
        userId: 'user-123',
        bikeId: 'bike-123',
        userRole: 'FREE',
      });

      // FORK should be excluded (bike override disables it), only CHAIN should remain
      expect(result.components).toHaveLength(1);
      expect(result.components[0].componentType).toBe('CHAIN');
    });

    it('should use component-level serviceDueAtHours over all preferences', async () => {
      // Global: FORK with 100h custom interval
      (prisma.userServicePreference as unknown as { findMany: jest.Mock }).findMany.mockResolvedValue([
        { componentType: 'FORK', trackingEnabled: true, customInterval: 100 },
      ]);

      // Bike override: FORK with 80h custom interval
      (prisma.bikeServicePreference as unknown as { findMany: jest.Mock }).findMany.mockResolvedValue([
        { componentType: 'FORK', trackingEnabled: true, customInterval: 80 },
      ]);

      // Component has serviceDueAtHours set to 50
      const forkWithOverride = {
        ...mockBike,
        components: [{ ...mockBike.components[1], serviceDueAtHours: 50 }],
      };

      (prisma.bike.findUnique as jest.Mock).mockResolvedValue(forkWithOverride);
      (prisma.ride.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.serviceLog.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.ride.findFirst as jest.Mock).mockResolvedValue({
        startTime: new Date('2024-01-01'),
      });

      const result = await generateBikePredictions({
        userId: 'user-123',
        bikeId: 'bike-123',
        userRole: 'FREE',
      });

      // Component-level serviceDueAtHours (50) takes priority over all preferences
      expect(result.components[0].serviceIntervalHours).toBe(50);
    });

    it('should return empty components array when all are disabled', async () => {
      // Global: both components disabled
      (prisma.userServicePreference as unknown as { findMany: jest.Mock }).findMany.mockResolvedValue([
        { componentType: 'CHAIN', trackingEnabled: false, customInterval: null },
        { componentType: 'FORK', trackingEnabled: false, customInterval: null },
      ]);

      (prisma.bike.findUnique as jest.Mock).mockResolvedValue(mockBike);
      (prisma.ride.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.serviceLog.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.ride.findFirst as jest.Mock).mockResolvedValue({
        startTime: new Date('2024-01-01'),
      });

      const result = await generateBikePredictions({
        userId: 'user-123',
        bikeId: 'bike-123',
        userRole: 'FREE',
      });

      expect(result.components).toHaveLength(0);
      expect(result.overallStatus).toBe('ALL_GOOD');
      expect(result.priorityComponent).toBeNull();
    });
  });
});
