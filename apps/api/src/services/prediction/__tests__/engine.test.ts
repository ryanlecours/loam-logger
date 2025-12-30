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
    },
    component: {
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
  });

  const mockBike = {
    id: 'bike-123',
    userId: 'user-123',
    nickname: 'Trail Slayer',
    manufacturer: 'Trek',
    model: 'Slash 9.9',
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
      ).rejects.toThrow('Bike not found');
    });

    it('should throw for non-existent bike', async () => {
      (prisma.bike.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        generateBikePredictions({
          userId: 'user-123',
          bikeId: 'bike-123',
          userRole: 'FREE',
        })
      ).rejects.toThrow('Bike not found');
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
      const overdueRides: RideMetrics[] = [
        {
          durationSeconds: 100 * 3600, // 100 hours
          distanceMiles: 10,
          elevationGainFeet: 1500,
          startTime: new Date('2024-01-10'),
        },
      ];

      (prisma.bike.findUnique as jest.Mock).mockResolvedValue({
        ...mockBike,
        components: [overdueComponent],
      });
      (prisma.ride.findMany as jest.Mock).mockResolvedValue(overdueRides);
      (prisma.serviceLog.findFirst as jest.Mock).mockResolvedValue(null);
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
});
