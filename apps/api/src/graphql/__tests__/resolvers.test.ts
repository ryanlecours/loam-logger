// Mock ESM dependencies
jest.mock('@paralleldrive/cuid2', () => ({
  createId: jest.fn(() => 'mock-cuid'),
}));

// Mock dependencies before imports
jest.mock('../../lib/prisma', () => ({
  prisma: {
    component: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    bike: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    ride: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn(),
    },
    rideWeather: {
      groupBy: jest.fn().mockResolvedValue([]),
    },
    stravaGearMapping: {
      deleteMany: jest.fn(),
    },
    serviceLog: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      delete: jest.fn(),
    },
    termsAcceptance: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    user: {
      update: jest.fn(),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ subscriptionTier: 'PRO', isFoundingRider: false, needsDowngradeSelection: false }),
    },
    bikeServicePreference: {
      findMany: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    bikeNotificationPreference: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    bikeComponentInstall: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('../../lib/rate-limit', () => ({
  checkMutationRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
}));

jest.mock('../../services/prediction/cache', () => ({
  invalidateBikePrediction: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/notification.service', () => ({
  clearServiceNotificationLogs: jest.fn().mockResolvedValue(undefined),
  isValidExpoPushToken: jest.fn((token: string) => token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken[')),
}));

jest.mock('../../lib/queue/weather.queue', () => ({
  enqueueWeatherJob: jest.fn(),
}));

// Prevent captureServerEvent calls from firing real PostHog events during
// tests. Without this, any dev machine or CI job with POSTHOG_API_KEY set
// would ship events to PostHog Cloud attributed to the hardcoded test
// distinctId (`user-123`), polluting production analytics.
jest.mock('../../lib/posthog', () => ({
  captureServerEvent: jest.fn(),
  flushPostHog: jest.fn().mockResolvedValue(undefined),
  invalidateOptOutCache: jest.fn(),
}));

import { resolvers } from '../resolvers';
import { prisma } from '../../lib/prisma';
import { checkMutationRateLimit } from '../../lib/rate-limit';
import { invalidateBikePrediction } from '../../services/prediction/cache';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockCheckMutationRateLimit = checkMutationRateLimit as jest.MockedFunction<typeof checkMutationRateLimit>;

// Helper to create mock GraphQL context
const createMockContext = (
  userId: string | null = 'user-123',
  reqOverrides: {
    ip?: string | undefined;
    headers?: Record<string, string | string[]>;
  } = {}
) => ({
  user: userId ? { id: userId } : null,
  loaders: {
    serviceLogsByComponentId: { load: jest.fn() },
    latestServiceLogByComponentId: { load: jest.fn() },
    weatherByRideId: { load: jest.fn() },
  },
  req: {
    // Only use default IP if ip is not explicitly passed in reqOverrides
    ip: 'ip' in reqOverrides ? reqOverrides.ip : '127.0.0.1',
    headers: reqOverrides.headers ?? {
      'user-agent': 'test-agent',
    },
  },
});

describe('GraphQL Resolvers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckMutationRateLimit.mockResolvedValue({ allowed: true, retryAfter: 0 });
  });

  describe('logComponentService', () => {
    const mutation = resolvers.Mutation.logComponentService;

    describe('authorization', () => {
      it('should throw Unauthorized when user is not authenticated', async () => {
        const ctx = createMockContext(null);

        await expect(
          mutation({}, { id: 'comp-1' }, ctx as never)
        ).rejects.toThrow('Unauthorized');

        // Prisma should not be called
        expect(mockPrisma.component.findUnique).not.toHaveBeenCalled();
      });

      it('should reject component not owned by user before parsing date', async () => {
        const ctx = createMockContext('user-123');
        mockPrisma.component.findUnique.mockResolvedValue({
          id: 'comp-1',
          userId: 'other-user', // Different user
          bikeId: 'bike-1',
          hoursUsed: 10,
        } as never);

        // Pass an invalid date - if parsing happened first, this would throw a different error
        await expect(
          mutation({}, { id: 'comp-1', performedAt: 'invalid-date' }, ctx as never)
        ).rejects.toThrow('Component not found');

        // Component was looked up but date parsing should NOT have happened
        expect(mockPrisma.component.findUnique).toHaveBeenCalledWith({
          where: { id: 'comp-1' },
          select: { userId: true, bikeId: true, hoursUsed: true },
        });
      });

      it('should reject non-existent component before parsing date', async () => {
        const ctx = createMockContext('user-123');
        mockPrisma.component.findUnique.mockResolvedValue(null);

        await expect(
          mutation({}, { id: 'comp-1', performedAt: 'invalid-date' }, ctx as never)
        ).rejects.toThrow('Component not found');
      });
    });

    describe('date validation', () => {
      beforeEach(() => {
        mockPrisma.component.findUnique.mockResolvedValue({
          id: 'comp-1',
          userId: 'user-123',
          bikeId: 'bike-1',
          hoursUsed: 10,
        } as never);
      });

      it('should accept valid ISO date string', async () => {
        const ctx = createMockContext('user-123');
        const validDate = '2024-01-15';

        mockPrisma.$transaction.mockImplementation(async (fn) => {
          if (typeof fn === 'function') {
            return fn(mockPrisma);
          }
          return [];
        });
        mockPrisma.serviceLog.create.mockResolvedValue({ id: 'log-1' } as never);
        mockPrisma.component.update.mockResolvedValue({ id: 'comp-1', hoursUsed: 0 } as never);

        const result = await mutation({}, { id: 'comp-1', performedAt: validDate }, ctx as never);

        expect(result).toBeDefined();
      });

      it('should reject invalid date format', async () => {
        const ctx = createMockContext('user-123');

        await expect(
          mutation({}, { id: 'comp-1', performedAt: 'not-a-date' }, ctx as never)
        ).rejects.toThrow('Invalid date format');
      });

      it('should reject future dates', async () => {
        const ctx = createMockContext('user-123');
        const futureDate = new Date();
        futureDate.setFullYear(futureDate.getFullYear() + 1);

        await expect(
          mutation({}, { id: 'comp-1', performedAt: futureDate.toISOString() }, ctx as never)
        ).rejects.toThrow('Service date cannot be in the future');
      });

      it('should default to current date when performedAt is null', async () => {
        const ctx = createMockContext('user-123');

        mockPrisma.$transaction.mockImplementation(async (fn) => {
          if (typeof fn === 'function') {
            return fn(mockPrisma);
          }
          return [];
        });
        mockPrisma.serviceLog.create.mockResolvedValue({ id: 'log-1' } as never);
        mockPrisma.component.update.mockResolvedValue({ id: 'comp-1', hoursUsed: 0 } as never);

        await mutation({}, { id: 'comp-1', performedAt: null }, ctx as never);

        expect(mockPrisma.serviceLog.create).toHaveBeenCalled();
        const createCall = mockPrisma.serviceLog.create.mock.calls[0][0];
        expect(createCall.data.performedAt).toBeInstanceOf(Date);
      });
    });

    describe('happy path', () => {
      it('should create service log and reset component hours', async () => {
        const ctx = createMockContext('user-123');
        mockPrisma.component.findUnique.mockResolvedValue({
          id: 'comp-1',
          userId: 'user-123',
          bikeId: 'bike-1',
          hoursUsed: 50,
        } as never);

        mockPrisma.$transaction.mockImplementation(async (fn) => {
          if (typeof fn === 'function') {
            return fn(mockPrisma);
          }
          return [];
        });
        mockPrisma.serviceLog.create.mockResolvedValue({ id: 'log-1' } as never);
        mockPrisma.component.update.mockResolvedValue({ id: 'comp-1', hoursUsed: 0 } as never);

        const result = await mutation({}, { id: 'comp-1' }, ctx as never);

        expect(mockPrisma.serviceLog.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            componentId: 'comp-1',
            hoursAtService: 50,
          }),
        });
        expect(mockPrisma.component.update).toHaveBeenCalledWith({
          where: { id: 'comp-1' },
          data: { hoursUsed: 0, lastServicedAt: expect.any(Date) },
        });
        expect(result).toEqual({ id: 'comp-1', hoursUsed: 0 });
      });

      it('should invalidate prediction cache', async () => {
        const ctx = createMockContext('user-123');
        mockPrisma.component.findUnique.mockResolvedValue({
          id: 'comp-1',
          userId: 'user-123',
          bikeId: 'bike-1',
          hoursUsed: 10,
        } as never);

        mockPrisma.$transaction.mockImplementation(async (fn) => {
          if (typeof fn === 'function') {
            return fn(mockPrisma);
          }
          return [];
        });
        mockPrisma.serviceLog.create.mockResolvedValue({ id: 'log-1' } as never);
        mockPrisma.component.update.mockResolvedValue({ id: 'comp-1', hoursUsed: 0 } as never);

        await mutation({}, { id: 'comp-1' }, ctx as never);

        expect(invalidateBikePrediction).toHaveBeenCalledWith('user-123', 'bike-1');
      });
    });
  });

  describe('bulkUpdateComponentBaselines', () => {
    const mutation = resolvers.Mutation.bulkUpdateComponentBaselines;

    describe('input validation', () => {
      it('should throw error when wearPercent < 0', async () => {
        const ctx = createMockContext('user-123');
        mockPrisma.component.findMany.mockResolvedValue([
          { id: 'comp-1', userId: 'user-123', bikeId: 'bike-1' },
        ] as never);

        mockPrisma.$transaction.mockImplementation(async (fn) => {
          if (typeof fn === 'function') {
            return fn(mockPrisma);
          }
          return [];
        });

        await expect(
          mutation(
            {},
            {
              input: {
                updates: [{ componentId: 'comp-1', wearPercent: -10, method: 'SLIDER' }],
              },
            },
            ctx as never
          )
        ).rejects.toThrow('wearPercent must be between 0 and 100, got -10');
      });

      it('should throw error when wearPercent > 100', async () => {
        const ctx = createMockContext('user-123');
        mockPrisma.component.findMany.mockResolvedValue([
          { id: 'comp-1', userId: 'user-123', bikeId: 'bike-1' },
        ] as never);

        mockPrisma.$transaction.mockImplementation(async (fn) => {
          if (typeof fn === 'function') {
            return fn(mockPrisma);
          }
          return [];
        });

        await expect(
          mutation(
            {},
            {
              input: {
                updates: [{ componentId: 'comp-1', wearPercent: 150, method: 'SLIDER' }],
              },
            },
            ctx as never
          )
        ).rejects.toThrow('wearPercent must be between 0 and 100, got 150');
      });

      it('should accept wearPercent at boundary value 0', async () => {
        const ctx = createMockContext('user-123');
        mockPrisma.component.findMany.mockResolvedValue([
          { id: 'comp-1', userId: 'user-123', bikeId: 'bike-1' },
        ] as never);

        mockPrisma.$transaction.mockImplementation(async (fn) => {
          if (typeof fn === 'function') {
            return fn(mockPrisma);
          }
          return [];
        });
        mockPrisma.component.update.mockResolvedValue({ id: 'comp-1' } as never);

        const result = await mutation(
          {},
          {
            input: {
              updates: [{ componentId: 'comp-1', wearPercent: 0, method: 'SLIDER' }],
            },
          },
          ctx as never
        );

        expect(result).toBeDefined();
      });

      it('should accept wearPercent at boundary value 100', async () => {
        const ctx = createMockContext('user-123');
        mockPrisma.component.findMany.mockResolvedValue([
          { id: 'comp-1', userId: 'user-123', bikeId: 'bike-1' },
        ] as never);

        mockPrisma.$transaction.mockImplementation(async (fn) => {
          if (typeof fn === 'function') {
            return fn(mockPrisma);
          }
          return [];
        });
        mockPrisma.component.update.mockResolvedValue({ id: 'comp-1' } as never);

        const result = await mutation(
          {},
          {
            input: {
              updates: [{ componentId: 'comp-1', wearPercent: 100, method: 'SLIDER' }],
            },
          },
          ctx as never
        );

        expect(result).toBeDefined();
      });

      it('should throw error when batch size > 50', async () => {
        const ctx = createMockContext('user-123');
        const updates = Array.from({ length: 51 }, (_, i) => ({
          componentId: `comp-${i}`,
          wearPercent: 50,
          method: 'SLIDER' as const,
        }));

        await expect(
          mutation({}, { input: { updates } }, ctx as never)
        ).rejects.toThrow('Cannot update more than 50 components at once');
      });

      it('should return empty array when updates is empty', async () => {
        const ctx = createMockContext('user-123');

        const result = await mutation({}, { input: { updates: [] } }, ctx as never);

        expect(result).toEqual([]);
      });
    });

    describe('authorization', () => {
      it('should reject components not owned by user', async () => {
        const ctx = createMockContext('user-123');
        mockPrisma.component.findMany.mockResolvedValue([
          { id: 'comp-1', userId: 'other-user', bikeId: 'bike-1' },
        ] as never);

        await expect(
          mutation(
            {},
            {
              input: {
                updates: [{ componentId: 'comp-1', wearPercent: 50, method: 'SLIDER' }],
              },
            },
            ctx as never
          )
        ).rejects.toThrow('Unauthorized');
      });

      it('should reject non-existent components', async () => {
        const ctx = createMockContext('user-123');
        mockPrisma.component.findMany.mockResolvedValue([] as never);

        await expect(
          mutation(
            {},
            {
              input: {
                updates: [{ componentId: 'comp-1', wearPercent: 50, method: 'SLIDER' }],
              },
            },
            ctx as never
          )
        ).rejects.toThrow('Component comp-1 not found');
      });
    });

    describe('confidence calculation', () => {
      beforeEach(() => {
        mockPrisma.component.findMany.mockResolvedValue([
          { id: 'comp-1', userId: 'user-123', bikeId: 'bike-1' },
        ] as never);
        mockPrisma.$transaction.mockImplementation(async (fn) => {
          if (typeof fn === 'function') {
            return fn(mockPrisma);
          }
          return [];
        });
        mockPrisma.component.update.mockResolvedValue({ id: 'comp-1' } as never);
      });

      it('should set HIGH confidence for DATES method with lastServicedAt', async () => {
        const ctx = createMockContext('user-123');

        await mutation(
          {},
          {
            input: {
              updates: [
                {
                  componentId: 'comp-1',
                  wearPercent: 50,
                  method: 'DATES',
                  lastServicedAt: '2024-01-01',
                },
              ],
            },
          },
          ctx as never
        );

        expect(mockPrisma.component.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              baselineConfidence: 'HIGH',
            }),
          })
        );
      });

      it('should set MEDIUM confidence for SLIDER method', async () => {
        const ctx = createMockContext('user-123');

        await mutation(
          {},
          {
            input: {
              updates: [{ componentId: 'comp-1', wearPercent: 50, method: 'SLIDER' }],
            },
          },
          ctx as never
        );

        expect(mockPrisma.component.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              baselineConfidence: 'MEDIUM',
            }),
          })
        );
      });

      it('should set LOW confidence for DEFAULT method', async () => {
        const ctx = createMockContext('user-123');

        await mutation(
          {},
          {
            input: {
              updates: [{ componentId: 'comp-1', wearPercent: 50, method: 'DEFAULT' }],
            },
          },
          ctx as never
        );

        expect(mockPrisma.component.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              baselineConfidence: 'LOW',
            }),
          })
        );
      });
    });
  });

  describe('updateBikesOrder', () => {
    const mutation = resolvers.Mutation.updateBikesOrder;

    describe('authorization', () => {
      it('should throw Unauthorized when user is not authenticated', async () => {
        const ctx = createMockContext(null);

        await expect(
          mutation({}, { bikeIds: ['bike-1'] }, ctx as never)
        ).rejects.toThrow('Unauthorized');
      });

      it('should reject bikes not owned by user', async () => {
        const ctx = createMockContext('user-123');
        // Return fewer bikes than requested (some don't belong to user)
        mockPrisma.bike.findMany.mockResolvedValue([
          { id: 'bike-1' },
        ] as never);

        await expect(
          mutation({}, { bikeIds: ['bike-1', 'bike-2'] }, ctx as never)
        ).rejects.toThrow('One or more bikes not found or not owned by user');
      });

      it('should reject non-existent bikes', async () => {
        const ctx = createMockContext('user-123');
        mockPrisma.bike.findMany.mockResolvedValue([] as never);

        await expect(
          mutation({}, { bikeIds: ['bike-1'] }, ctx as never)
        ).rejects.toThrow('One or more bikes not found or not owned by user');
      });
    });

    describe('happy path', () => {
      it('should update sortOrder for each bike based on array index', async () => {
        const ctx = createMockContext('user-123');
        mockPrisma.bike.findMany
          .mockResolvedValueOnce([{ id: 'bike-1' }, { id: 'bike-2' }, { id: 'bike-3' }] as never)
          .mockResolvedValueOnce([
            { id: 'bike-2', sortOrder: 0 },
            { id: 'bike-3', sortOrder: 1 },
            { id: 'bike-1', sortOrder: 2 },
          ] as never);

        mockPrisma.$transaction.mockResolvedValue([{}, {}, {}] as never);

        await mutation({}, { bikeIds: ['bike-2', 'bike-3', 'bike-1'] }, ctx as never);

        // $transaction is called with an array (bike.update calls for each bike)
        expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
        expect(mockPrisma.$transaction).toHaveBeenCalledWith(expect.any(Array));
      });

      it('should return all bikes in new sort order', async () => {
        const ctx = createMockContext('user-123');
        const expectedBikes = [
          { id: 'bike-2', sortOrder: 0, components: [] },
          { id: 'bike-1', sortOrder: 1, components: [] },
        ];

        mockPrisma.bike.findMany
          .mockResolvedValueOnce([{ id: 'bike-1' }, { id: 'bike-2' }] as never)
          .mockResolvedValueOnce(expectedBikes as never);

        mockPrisma.$transaction.mockResolvedValue([{}, {}] as never);

        const result = await mutation({}, { bikeIds: ['bike-2', 'bike-1'] }, ctx as never);

        expect(result).toEqual(expectedBikes);
        expect(mockPrisma.bike.findMany).toHaveBeenLastCalledWith({
          where: { userId: 'user-123' },
          orderBy: { sortOrder: 'asc' },
          include: { components: true },
        });
      });
    });

    describe('edge cases', () => {
      it('should handle single bike', async () => {
        const ctx = createMockContext('user-123');
        mockPrisma.bike.findMany
          .mockResolvedValueOnce([{ id: 'bike-1' }] as never)
          .mockResolvedValueOnce([{ id: 'bike-1', sortOrder: 0, components: [] }] as never);

        mockPrisma.$transaction.mockResolvedValue([{}] as never);

        const result = await mutation({}, { bikeIds: ['bike-1'] }, ctx as never);

        expect(result).toHaveLength(1);
      });
    });
  });

  describe('acceptTerms', () => {
    const mutation = resolvers.Mutation.acceptTerms;

    it('should accept valid terms version', async () => {
      const ctx = createMockContext('user-123');
      const mockAcceptance = {
        id: 'acceptance-1',
        userId: 'user-123',
        termsVersion: '1.2.0',
        acceptedAt: new Date('2026-01-14T12:00:00Z'),
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
      };

      mockPrisma.termsAcceptance.upsert.mockResolvedValue(mockAcceptance as never);

      const result = await mutation(
        {},
        { input: { termsVersion: '1.2.0' } },
        ctx as never
      );

      expect(result).toEqual({
        success: true,
        acceptedAt: '2026-01-14T12:00:00.000Z',
      });
      expect(mockPrisma.termsAcceptance.upsert).toHaveBeenCalledWith({
        where: {
          userId_termsVersion: {
            userId: 'user-123',
            termsVersion: '1.2.0',
          },
        },
        create: {
          userId: 'user-123',
          termsVersion: '1.2.0',
          ipAddress: '127.0.0.1',
          userAgent: 'test-agent',
        },
        update: {},
      });
    });

    it('should reject invalid terms version', async () => {
      const ctx = createMockContext('user-123');

      await expect(
        mutation({}, { input: { termsVersion: '0.9.0' } }, ctx as never)
      ).rejects.toThrow('Invalid terms version');

      expect(mockPrisma.termsAcceptance.upsert).not.toHaveBeenCalled();
    });

    it('should be idempotent (accept same version twice)', async () => {
      const ctx = createMockContext('user-123');
      const originalDate = new Date('2026-01-10T12:00:00Z');
      const mockAcceptance = {
        id: 'acceptance-1',
        userId: 'user-123',
        termsVersion: '1.2.0',
        acceptedAt: originalDate,
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
      };

      // Upsert returns existing record (no update)
      mockPrisma.termsAcceptance.upsert.mockResolvedValue(mockAcceptance as never);

      const result = await mutation(
        {},
        { input: { termsVersion: '1.2.0' } },
        ctx as never
      );

      // Should return success with original timestamp
      expect(result).toEqual({
        success: true,
        acceptedAt: '2026-01-10T12:00:00.000Z',
      });
    });

    it('should capture IP and user agent', async () => {
      const ctx = createMockContext('user-123', {
        ip: '192.168.1.100',
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
      });
      const mockAcceptance = {
        id: 'acceptance-1',
        userId: 'user-123',
        termsVersion: '1.2.0',
        acceptedAt: new Date(),
        ipAddress: '192.168.1.100',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      };

      mockPrisma.termsAcceptance.upsert.mockResolvedValue(mockAcceptance as never);

      await mutation({}, { input: { termsVersion: '1.2.0' } }, ctx as never);

      expect(mockPrisma.termsAcceptance.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            ipAddress: '192.168.1.100',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          }),
        })
      );
    });

    it('should use rightmost IP from x-forwarded-for header', async () => {
      const ctx = createMockContext('user-123', {
        ip: undefined,
        headers: {
          'x-forwarded-for': '1.2.3.4, 5.6.7.8, 10.0.0.1',
          'user-agent': 'test-agent',
        },
      });
      const mockAcceptance = {
        id: 'acceptance-1',
        userId: 'user-123',
        termsVersion: '1.2.0',
        acceptedAt: new Date(),
        ipAddress: '10.0.0.1',
        userAgent: 'test-agent',
      };

      mockPrisma.termsAcceptance.upsert.mockResolvedValue(mockAcceptance as never);

      await mutation({}, { input: { termsVersion: '1.2.0' } }, ctx as never);

      expect(mockPrisma.termsAcceptance.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            ipAddress: '10.0.0.1',
          }),
        })
      );
    });

    it('should require authentication', async () => {
      const ctx = createMockContext(null);

      await expect(
        mutation({}, { input: { termsVersion: '1.2.0' } }, ctx as never)
      ).rejects.toThrow('Unauthorized');

      expect(mockPrisma.termsAcceptance.upsert).not.toHaveBeenCalled();
    });
  });

  describe('User.hasAcceptedCurrentTerms', () => {
    const resolver = resolvers.User.hasAcceptedCurrentTerms;

    it('should return false when terms not accepted', async () => {
      mockPrisma.termsAcceptance.findUnique.mockResolvedValue(null);

      const result = await resolver({ id: 'user-123' });

      expect(result).toBe(false);
      expect(mockPrisma.termsAcceptance.findUnique).toHaveBeenCalledWith({
        where: {
          userId_termsVersion: {
            userId: 'user-123',
            termsVersion: '1.2.0',
          },
        },
      });
    });

    it('should return true when current version accepted', async () => {
      mockPrisma.termsAcceptance.findUnique.mockResolvedValue({
        id: 'acceptance-1',
        userId: 'user-123',
        termsVersion: '1.2.0',
        acceptedAt: new Date(),
      } as never);

      const result = await resolver({ id: 'user-123' });

      expect(result).toBe(true);
    });

    it('should return false when old version accepted (queries for current version)', async () => {
      // The resolver queries for current version, so if user only accepted 1.1.0,
      // findUnique for 1.2.0 returns null
      mockPrisma.termsAcceptance.findUnique.mockResolvedValue(null);

      const result = await resolver({ id: 'user-123' });

      expect(result).toBe(false);
      // Verify it queried for current version, not old
      expect(mockPrisma.termsAcceptance.findUnique).toHaveBeenCalledWith({
        where: {
          userId_termsVersion: {
            userId: 'user-123',
            termsVersion: '1.2.0',
          },
        },
      });
    });
  });

  describe('markPairedComponentMigrationSeen', () => {
    const mutation = resolvers.Mutation.markPairedComponentMigrationSeen;

    it('should throw Unauthorized when user is not authenticated', async () => {
      const ctx = createMockContext(null);

      await expect(mutation({}, {}, ctx as never)).rejects.toThrow('Unauthorized');

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('should update user with pairedComponentMigrationSeenAt timestamp', async () => {
      const ctx = createMockContext('user-123');
      const mockUser = {
        id: 'user-123',
        pairedComponentMigrationSeenAt: new Date(),
      };

      mockPrisma.user.update.mockResolvedValue(mockUser as never);

      const result = await mutation({}, {}, ctx as never);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: {
          pairedComponentMigrationSeenAt: expect.any(Date),
        },
      });
      expect(result).toEqual(mockUser);
    });
  });

  describe('migratePairedComponents', () => {
    const mutation = resolvers.Mutation.migratePairedComponents;

    it('should throw Unauthorized when user is not authenticated', async () => {
      const ctx = createMockContext(null);

      await expect(mutation({}, {}, ctx as never)).rejects.toThrow('Unauthorized');
    });

    it('should return empty result when user already has paired components (idempotency)', async () => {
      const ctx = createMockContext('user-123');
      // User already has a component with pairGroupId set
      mockPrisma.component.findFirst.mockResolvedValue({
        id: 'comp-existing',
        pairGroupId: 'existing-pair',
      } as never);

      const result = await mutation({}, {}, ctx as never);

      expect(result).toEqual({ migratedCount: 0, components: [] });
      // Should not proceed to findMany for unpaired components
      expect(mockPrisma.component.findMany).not.toHaveBeenCalled();
    });

    it('should return empty result when no unpaired components exist', async () => {
      const ctx = createMockContext('user-123');
      // No existing paired components (idempotency check passes)
      mockPrisma.component.findFirst.mockResolvedValue(null);
      mockPrisma.component.findMany.mockResolvedValue([]);

      const result = await mutation({}, {}, ctx as never);

      expect(result).toEqual({ migratedCount: 0, components: [] });
    });

    it('should migrate unpaired TIRES components to FRONT/REAR pairs', async () => {
      const ctx = createMockContext('user-123');
      const unpairedComponent = {
        id: 'comp-1',
        type: 'TIRES',
        location: 'NONE',
        brand: 'Maxxis',
        model: 'Minion DHF',
        bikeId: 'bike-1',
        userId: 'user-123',
        hoursUsed: 50,
        serviceDueAtHours: 100,
        installedAt: new Date(),
        isStock: false,
        baselineWearPercent: 0,
        baselineMethod: 'DEFAULT',
        baselineConfidence: 'HIGH',
        baselineSetAt: new Date(),
        lastServicedAt: null,
        retiredAt: null,
      };

      const newRearComponent = {
        ...unpairedComponent,
        id: 'comp-2',
        location: 'REAR',
        pairGroupId: 'pair-123',
      };

      // No existing paired components (idempotency check passes)
      mockPrisma.component.findFirst.mockResolvedValue(null);
      mockPrisma.component.findMany
        .mockResolvedValueOnce([unpairedComponent] as never) // First call - find unpaired
        .mockResolvedValueOnce([{ ...unpairedComponent, location: 'FRONT', pairGroupId: 'pair-123' }] as never); // Second call - refetch updated

      mockPrisma.$transaction.mockImplementation(async (fn) => {
        if (typeof fn === 'function') {
          const mockTx = {
            component: {
              update: jest.fn().mockResolvedValue({ ...unpairedComponent, location: 'FRONT', pairGroupId: 'pair-123' }),
              create: jest.fn().mockResolvedValue(newRearComponent),
            },
          };
          return fn(mockTx);
        }
        return [];
      });

      const result = await mutation({}, {}, ctx as never);

      expect(result.migratedCount).toBe(1);
      expect(mockPrisma.component.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-123', pairGroupId: { not: null } },
      });
      expect(mockPrisma.component.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-123',
          type: { in: ['TIRES', 'BRAKE_PAD', 'BRAKE_ROTOR', 'BRAKES'] },
          location: 'NONE',
          retiredAt: null,
        },
      });
    });

    it('should migrate multiple component types', async () => {
      const ctx = createMockContext('user-123');
      const unpairedComponents = [
        { id: 'comp-1', type: 'TIRES', location: 'NONE', brand: 'Maxxis', model: 'DHF', bikeId: 'bike-1', userId: 'user-123', hoursUsed: 50, retiredAt: null },
        { id: 'comp-2', type: 'BRAKE_PAD', location: 'NONE', brand: 'Shimano', model: 'B01S', bikeId: 'bike-1', userId: 'user-123', hoursUsed: 20, retiredAt: null },
      ];

      // No existing paired components (idempotency check passes)
      mockPrisma.component.findFirst.mockResolvedValue(null);
      mockPrisma.component.findMany
        .mockResolvedValueOnce(unpairedComponents as never)
        .mockResolvedValueOnce(unpairedComponents.map(c => ({ ...c, location: 'FRONT', pairGroupId: `pair-${c.id}` })) as never);

      mockPrisma.$transaction.mockImplementation(async (fn) => {
        if (typeof fn === 'function') {
          const mockTx = {
            component: {
              update: jest.fn().mockImplementation(({ where }) => {
                const comp = unpairedComponents.find(c => c.id === where.id);
                return Promise.resolve({ ...comp, location: 'FRONT', pairGroupId: `pair-${where.id}` });
              }),
              create: jest.fn().mockImplementation(({ data }) => {
                return Promise.resolve({ ...data, id: `new-${data.pairGroupId}` });
              }),
            },
          };
          return fn(mockTx);
        }
        return [];
      });

      const result = await mutation({}, {}, ctx as never);

      expect(result.migratedCount).toBe(2);
    });
  });

  describe('replaceComponent', () => {
    const mutation = resolvers.Mutation.replaceComponent;

    it('should throw Unauthorized when user is not authenticated', async () => {
      const ctx = createMockContext(null);

      await expect(
        mutation({}, { input: { componentId: 'comp-1', newBrand: 'Maxxis', newModel: 'Assegai' } }, ctx as never)
      ).rejects.toThrow('Unauthorized');
    });

    it('should throw NOT_FOUND when component does not exist', async () => {
      const ctx = createMockContext('user-123');
      mockPrisma.component.findFirst.mockResolvedValue(null);

      await expect(
        mutation({}, { input: { componentId: 'comp-1', newBrand: 'Maxxis', newModel: 'Assegai' } }, ctx as never)
      ).rejects.toThrow('Component not found');
    });

    it('should throw NOT_FOUND when component belongs to different user', async () => {
      const ctx = createMockContext('user-123');
      // findFirst with userId filter returns null when component belongs to different user
      mockPrisma.component.findFirst.mockResolvedValue(null);

      await expect(
        mutation({}, { input: { componentId: 'comp-1', newBrand: 'Maxxis', newModel: 'Assegai' } }, ctx as never)
      ).rejects.toThrow('Component not found');
    });

    it('should retire old component and create new one', async () => {
      const ctx = createMockContext('user-123');
      const existingComponent = {
        id: 'comp-1',
        type: 'TIRES',
        location: 'FRONT',
        brand: 'Maxxis',
        model: 'Minion DHF',
        bikeId: 'bike-1',
        userId: 'user-123',
        pairGroupId: 'pair-123',
      };

      mockPrisma.component.findFirst.mockResolvedValue(existingComponent as never);

      const retiredComponent = { ...existingComponent, retiredAt: new Date() };
      const newComponent = {
        id: 'comp-new',
        type: 'TIRES',
        location: 'FRONT',
        brand: 'Maxxis',
        model: 'Assegai',
        bikeId: 'bike-1',
        userId: 'user-123',
        pairGroupId: 'new-pair-123',
        hoursUsed: 0,
      };

      mockPrisma.$transaction.mockImplementation(async (fn) => {
        if (typeof fn === 'function') {
          const mockTx = {
            component: {
              update: jest.fn()
                .mockResolvedValueOnce(retiredComponent) // retire old
                .mockResolvedValueOnce({ ...retiredComponent, replacedById: newComponent.id }), // set replacedById
              create: jest.fn().mockResolvedValue(newComponent),
              findFirst: jest.fn().mockResolvedValue(null), // no paired component (alsoReplacePair not set)
            },
            serviceLog: {
              create: jest.fn().mockResolvedValue({ id: 'log-1' }),
            },
            bikeComponentInstall: {
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              create: jest.fn().mockResolvedValue({ id: 'install-1' }),
            },
          };
          return fn(mockTx);
        }
        return [];
      });

      const result = await mutation(
        {},
        { input: { componentId: 'comp-1', newBrand: 'Maxxis', newModel: 'Assegai' } },
        ctx as never
      );

      expect(result.replacedComponents).toHaveLength(1);
      expect(result.newComponents).toHaveLength(1);
    });

    it('closes the old install row and creates a new one stamped with installedAt', async () => {
      // Pins the replace-component install-row fix: the old component's
      // open BikeComponentInstall row must be closed (removedAt stamped
      // with the new install date), AND a fresh install row created for
      // the replacement with the same date. Without these writes, the
      // BikeHistory timeline would show the old component as still
      // installed and the new component with no install event at all.
      const ctx = createMockContext('user-123');
      const existingComponent = {
        id: 'comp-1',
        type: 'TIRES',
        location: 'FRONT',
        brand: 'Maxxis',
        model: 'Minion DHF',
        bikeId: 'bike-1',
        userId: 'user-123',
        pairGroupId: null,
      };
      mockPrisma.component.findFirst.mockResolvedValue(existingComponent as never);

      const userInstalledAt = '2025-11-15T00:00:00.000Z';
      const installUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
      const installCreate = jest.fn().mockResolvedValue({ id: 'install-new' });
      mockPrisma.$transaction.mockImplementation(async (fn) => {
        if (typeof fn !== 'function') return [];
        const mockTx = {
          component: {
            update: jest
              .fn()
              .mockResolvedValueOnce({ ...existingComponent, retiredAt: new Date(userInstalledAt) })
              .mockResolvedValueOnce({ ...existingComponent, replacedById: 'comp-new' }),
            create: jest.fn().mockResolvedValue({
              id: 'comp-new',
              type: 'TIRES',
              location: 'FRONT',
              bikeId: 'bike-1',
            }),
            findFirst: jest.fn().mockResolvedValue(null),
          },
          serviceLog: { create: jest.fn().mockResolvedValue({ id: 'log-new' }) },
          bikeComponentInstall: {
            updateMany: installUpdateMany,
            create: installCreate,
          },
        };
        return fn(mockTx);
      });

      await mutation(
        {},
        {
          input: {
            componentId: 'comp-1',
            newBrand: 'Maxxis',
            newModel: 'Assegai',
            installedAt: userInstalledAt,
          },
        },
        ctx as never
      );

      // Old install row closed: filtered to this component's open install,
      // stamped with the user-chosen install date.
      expect(installUpdateMany).toHaveBeenCalledWith({
        where: { componentId: 'comp-1', removedAt: null },
        data: { removedAt: new Date(userInstalledAt) },
      });

      // New install row opened: same date as the closure, pointing at the
      // replacement component on the same bike/slot.
      expect(installCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-123',
          bikeId: 'bike-1',
          componentId: 'comp-new',
          installedAt: new Date(userInstalledAt),
        }),
      });
    });

    it('should replace paired component when alsoReplacePair is true', async () => {
      const ctx = createMockContext('user-123');
      const existingComponent = {
        id: 'comp-1',
        type: 'TIRES',
        location: 'FRONT',
        brand: 'Maxxis',
        model: 'Minion DHF',
        bikeId: 'bike-1',
        userId: 'user-123',
        pairGroupId: 'pair-123',
      };

      const pairedComponent = {
        id: 'comp-2',
        type: 'TIRES',
        location: 'REAR',
        brand: 'Maxxis',
        model: 'Minion DHR II',
        bikeId: 'bike-1',
        userId: 'user-123',
        pairGroupId: 'pair-123',
      };

      mockPrisma.component.findFirst.mockResolvedValue(existingComponent as never);

      mockPrisma.$transaction.mockImplementation(async (fn) => {
        if (typeof fn === 'function') {
          const mockTx = {
            component: {
              update: jest.fn().mockImplementation(({ where }) => {
                if (where.id === 'comp-1') {
                  return Promise.resolve({ ...existingComponent, retiredAt: new Date() });
                }
                if (where.id === 'comp-2') {
                  return Promise.resolve({ ...pairedComponent, retiredAt: new Date() });
                }
                return Promise.resolve({});
              }),
              create: jest.fn().mockImplementation(({ data }) => {
                return Promise.resolve({
                  id: `new-${data.location}`,
                  ...data,
                });
              }),
              findFirst: jest.fn().mockResolvedValue(pairedComponent), // paired component exists
            },
            serviceLog: {
              create: jest.fn().mockResolvedValue({ id: 'log-1' }),
            },
            bikeComponentInstall: {
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              create: jest.fn().mockResolvedValue({ id: 'install-1' }),
            },
          };
          return fn(mockTx);
        }
        return [];
      });

      const result = await mutation(
        {},
        {
          input: {
            componentId: 'comp-1',
            newBrand: 'Maxxis',
            newModel: 'Assegai',
            alsoReplacePair: true,
            pairBrand: 'Maxxis',
            pairModel: 'Dissector',
          },
        },
        ctx as never
      );

      expect(result.replacedComponents).toHaveLength(2);
      expect(result.newComponents).toHaveLength(2);
    });
  });

  describe('Component.pairedComponent resolver', () => {
    const resolver = resolvers.Component.pairedComponent;

    it('should return null when component has no pairGroupId', async () => {
      const component = { id: 'comp-1', pairGroupId: null };

      const result = await resolver(component as never);

      expect(result).toBeNull();
      expect(mockPrisma.component.findFirst).not.toHaveBeenCalled();
    });

    it('should find paired component by pairGroupId', async () => {
      const component = { id: 'comp-1', pairGroupId: 'pair-123' };
      const pairedComponent = { id: 'comp-2', pairGroupId: 'pair-123', location: 'REAR' };

      mockPrisma.component.findFirst.mockResolvedValue(pairedComponent as never);

      const result = await resolver(component as never);

      expect(mockPrisma.component.findFirst).toHaveBeenCalledWith({
        where: {
          pairGroupId: 'pair-123',
          id: { not: 'comp-1' },
          retiredAt: null,
        },
      });
      expect(result).toEqual(pairedComponent);
    });
  });

  describe('User.pairedComponentMigrationSeenAt resolver', () => {
    const resolver = resolvers.User.pairedComponentMigrationSeenAt;

    it('should return null when not set', () => {
      const result = resolver({ pairedComponentMigrationSeenAt: null });
      expect(result).toBeNull();
    });

    it('should return ISO string when set', () => {
      const date = new Date('2026-01-28T12:00:00Z');
      const result = resolver({ pairedComponentMigrationSeenAt: date });
      expect(result).toBe('2026-01-28T12:00:00.000Z');
    });
  });

  describe('User.createdAt resolver', () => {
    const resolver = resolvers.User.createdAt;

    it('should return ISO string', () => {
      const date = new Date('2026-01-15T10:00:00Z');
      const result = resolver({ createdAt: date });
      expect(result).toBe('2026-01-15T10:00:00.000Z');
    });
  });

  describe('User.hasPassword resolver', () => {
    const resolver = resolvers.User.hasPassword;

    it('should return false when passwordHash is null', () => {
      const result = resolver({ passwordHash: null });
      expect(result).toBe(false);
    });

    it('should return false when passwordHash is undefined', () => {
      const result = resolver({ passwordHash: undefined });
      expect(result).toBe(false);
    });

    it('should return true when passwordHash is set', () => {
      const result = resolver({ passwordHash: '$2b$10$somehashedpassword' });
      expect(result).toBe(true);
    });
  });

  describe('Component.type resolver (WHEELS to WHEEL_HUBS mapping)', () => {
    const resolver = resolvers.Component.type;

    it('should map WHEELS to WHEEL_HUBS for backward compatibility', () => {
      const component = { type: 'WHEELS' };
      const result = resolver(component as never);
      expect(result).toBe('WHEEL_HUBS');
    });

    it('should pass through WHEEL_HUBS unchanged', () => {
      const component = { type: 'WHEEL_HUBS' };
      const result = resolver(component as never);
      expect(result).toBe('WHEEL_HUBS');
    });

    it('should pass through other component types unchanged', () => {
      const types = ['FORK', 'SHOCK', 'BRAKES', 'TIRES', 'CHAIN', 'CASSETTE', 'DROPPER'];
      types.forEach(type => {
        const component = { type };
        const result = resolver(component as never);
        expect(result).toBe(type);
      });
    });
  });

  describe('Query.components (type filter mapping)', () => {
    const query = resolvers.Query.components;

    beforeEach(() => {
      mockPrisma.component.findMany.mockResolvedValue([]);
    });

    it('should pass WHEEL_HUBS to Prisma (Prisma handles @map internally)', async () => {
      const ctx = createMockContext('user-123');

      await query(
        {},
        { filter: { types: ['WHEEL_HUBS', 'FORK'] } },
        ctx as never
      );

      expect(mockPrisma.component.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-123',
          type: { in: ['WHEEL_HUBS', 'FORK'] },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should pass through other types unchanged in filter', async () => {
      const ctx = createMockContext('user-123');

      await query(
        {},
        { filter: { types: ['FORK', 'SHOCK', 'CHAIN'] } },
        ctx as never
      );

      expect(mockPrisma.component.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-123',
          type: { in: ['FORK', 'SHOCK', 'CHAIN'] },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should handle filter with onlySpare and types including WHEEL_HUBS', async () => {
      const ctx = createMockContext('user-123');

      await query(
        {},
        { filter: { onlySpare: true, types: ['FORK', 'SHOCK', 'DROPPER', 'WHEEL_HUBS'] } },
        ctx as never
      );

      expect(mockPrisma.component.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-123',
          bikeId: null,
          type: { in: ['FORK', 'SHOCK', 'DROPPER', 'WHEEL_HUBS'] },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should work without type filter', async () => {
      const ctx = createMockContext('user-123');

      await query(
        {},
        { filter: { onlySpare: true } },
        ctx as never
      );

      expect(mockPrisma.component.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-123',
          bikeId: null,
        },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('updateBikeServicePreferences', () => {
    const mutation = resolvers.Mutation.updateBikeServicePreferences;

    describe('authorization', () => {
      it('should throw Unauthorized when user is not authenticated', async () => {
        const ctx = createMockContext(null);

        await expect(
          mutation(
            {},
            { input: { bikeId: 'bike-1', preferences: [] } },
            ctx as never
          )
        ).rejects.toThrow('Unauthorized');
      });

      it('should throw when bike not found', async () => {
        const ctx = createMockContext('user-123');
        mockPrisma.bike.findUnique.mockResolvedValue(null);

        await expect(
          mutation(
            {},
            { input: { bikeId: 'bike-1', preferences: [] } },
            ctx as never
          )
        ).rejects.toThrow('Bike not found');
      });

      it('should throw when bike belongs to different user', async () => {
        const ctx = createMockContext('user-123');
        mockPrisma.bike.findUnique.mockResolvedValue({
          id: 'bike-1',
          userId: 'other-user',
        } as never);

        await expect(
          mutation(
            {},
            { input: { bikeId: 'bike-1', preferences: [] } },
            ctx as never
          )
        ).rejects.toThrow('Bike not found');
      });
    });

    describe('rate limiting', () => {
      it('should throw when rate limited', async () => {
        const ctx = createMockContext('user-123');
        mockCheckMutationRateLimit.mockResolvedValue({
          allowed: false,
          retryAfter: 60,
        });

        await expect(
          mutation(
            {},
            { input: { bikeId: 'bike-1', preferences: [] } },
            ctx as never
          )
        ).rejects.toThrow('Rate limit exceeded');
      });
    });

    describe('validation', () => {
      beforeEach(() => {
        mockPrisma.bike.findUnique.mockResolvedValue({
          id: 'bike-1',
          userId: 'user-123',
        } as never);
      });

      it('should reject invalid component type', async () => {
        const ctx = createMockContext('user-123');

        await expect(
          mutation(
            {},
            {
              input: {
                bikeId: 'bike-1',
                preferences: [
                  { componentType: 'INVALID_TYPE', trackingEnabled: true },
                ],
              },
            },
            ctx as never
          )
        ).rejects.toThrow('Invalid component type');
      });

      it('should reject custom interval <= 0', async () => {
        const ctx = createMockContext('user-123');

        await expect(
          mutation(
            {},
            {
              input: {
                bikeId: 'bike-1',
                preferences: [
                  { componentType: 'FORK', trackingEnabled: true, customInterval: 0 },
                ],
              },
            },
            ctx as never
          )
        ).rejects.toThrow('Invalid custom interval');
      });

      it('should reject custom interval > 1000', async () => {
        const ctx = createMockContext('user-123');

        await expect(
          mutation(
            {},
            {
              input: {
                bikeId: 'bike-1',
                preferences: [
                  { componentType: 'FORK', trackingEnabled: true, customInterval: 1001 },
                ],
              },
            },
            ctx as never
          )
        ).rejects.toThrow('Invalid custom interval');
      });
    });

    describe('happy path', () => {
      // Create a mock transaction client that tracks calls
      const mockTxDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
      const mockTxUpsert = jest.fn();

      beforeEach(() => {
        mockPrisma.bike.findUnique.mockResolvedValue({
          id: 'bike-1',
          userId: 'user-123',
        } as never);

        // Reset transaction mocks
        mockTxDeleteMany.mockClear().mockResolvedValue({ count: 0 });
        mockTxUpsert.mockClear();

        // Mock $transaction to execute the callback with a mock tx client
        mockPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
          const mockTx = {
            bikeServicePreference: {
              deleteMany: mockTxDeleteMany,
              upsert: mockTxUpsert,
            },
          };
          return callback(mockTx);
        });
      });

      it('should upsert preferences and delete removed ones', async () => {
        const ctx = createMockContext('user-123');
        const mockResult = { id: 'pref-1', componentType: 'FORK', trackingEnabled: true, customInterval: 50 };
        mockTxUpsert.mockResolvedValue(mockResult);

        const result = await mutation(
          {},
          {
            input: {
              bikeId: 'bike-1',
              preferences: [
                { componentType: 'FORK', trackingEnabled: true, customInterval: 50 },
              ],
            },
          },
          ctx as never
        );

        // Should delete preferences not in input (within transaction)
        expect(mockTxDeleteMany).toHaveBeenCalledWith({
          where: {
            bikeId: 'bike-1',
            componentType: { notIn: ['FORK'] },
          },
        });

        // Should upsert the preferences (within transaction)
        expect(mockTxUpsert).toHaveBeenCalledWith({
          where: {
            bikeId_componentType: {
              bikeId: 'bike-1',
              componentType: 'FORK',
            },
          },
          create: {
            bikeId: 'bike-1',
            componentType: 'FORK',
            trackingEnabled: true,
            customInterval: 50,
          },
          update: {
            trackingEnabled: true,
            customInterval: 50,
          },
        });

        expect(result).toEqual([mockResult]);
      });

      it('should return empty array when no preferences provided', async () => {
        const ctx = createMockContext('user-123');

        const result = await mutation(
          {},
          {
            input: {
              bikeId: 'bike-1',
              preferences: [],
            },
          },
          ctx as never
        );

        // Should delete all existing preferences (within transaction)
        expect(mockTxDeleteMany).toHaveBeenCalledWith({
          where: {
            bikeId: 'bike-1',
            componentType: { notIn: [] },
          },
        });

        // Should not upsert anything
        expect(mockTxUpsert).not.toHaveBeenCalled();

        expect(result).toEqual([]);
      });

      it('should invalidate prediction cache after update', async () => {
        const ctx = createMockContext('user-123');

        await mutation(
          {},
          {
            input: {
              bikeId: 'bike-1',
              preferences: [],
            },
          },
          ctx as never
        );

        expect(invalidateBikePrediction).toHaveBeenCalledWith('user-123', 'bike-1');
      });

      it('should handle null custom interval', async () => {
        const ctx = createMockContext('user-123');
        const mockResult = { id: 'pref-1', componentType: 'FORK', trackingEnabled: false, customInterval: null };
        mockTxUpsert.mockResolvedValue(mockResult);

        const result = await mutation(
          {},
          {
            input: {
              bikeId: 'bike-1',
              preferences: [
                { componentType: 'FORK', trackingEnabled: false, customInterval: null },
              ],
            },
          },
          ctx as never
        );

        // Should upsert with null customInterval
        expect(mockTxUpsert).toHaveBeenCalledWith({
          where: {
            bikeId_componentType: {
              bikeId: 'bike-1',
              componentType: 'FORK',
            },
          },
          create: {
            bikeId: 'bike-1',
            componentType: 'FORK',
            trackingEnabled: false,
            customInterval: null,
          },
          update: {
            trackingEnabled: false,
            customInterval: null,
          },
        });

        expect(result).toEqual([mockResult]);
      });
    });
  });

  describe('Bike.servicePreferences', () => {
    const resolver = resolvers.Bike.servicePreferences;

    it('should return pre-loaded servicePreferences if available', async () => {
      const bike = {
        id: 'bike-1',
        servicePreferences: [
          { id: 'pref-1', componentType: 'FORK', trackingEnabled: true },
        ],
      };

      const result = await resolver(bike as never, {}, {} as never);

      expect(result).toEqual(bike.servicePreferences);
      expect((mockPrisma.bikeServicePreference as unknown as { findMany: jest.Mock }).findMany).not.toHaveBeenCalled();
    });

    it('should fetch from database if not pre-loaded', async () => {
      const bike = { id: 'bike-1' };
      const mockPrefs = [
        { id: 'pref-1', componentType: 'FORK', trackingEnabled: true },
      ];
      (mockPrisma.bikeServicePreference as unknown as { findMany: jest.Mock }).findMany.mockResolvedValue(mockPrefs);

      const result = await resolver(bike as never, {}, {} as never);

      expect((mockPrisma.bikeServicePreference as unknown as { findMany: jest.Mock }).findMany).toHaveBeenCalledWith({
        where: { bikeId: 'bike-1' },
      });
      expect(result).toEqual(mockPrefs);
    });
  });

  describe('Bike.notificationPreference', () => {
    const resolver = resolvers.Bike.notificationPreference;

    it('should fetch notification preference from database', async () => {
      const bike = { id: 'bike-1' };
      const mockPref = {
        id: 'pref-1',
        bikeId: 'bike-1',
        serviceNotificationsEnabled: true,
        serviceNotificationMode: 'RIDES_BEFORE',
        serviceNotificationThreshold: 3,
      };
      (mockPrisma.bikeNotificationPreference.findUnique as jest.Mock).mockResolvedValue(mockPref);

      const result = await resolver(bike as never, {}, {} as never);

      expect(mockPrisma.bikeNotificationPreference.findUnique).toHaveBeenCalledWith({
        where: { bikeId: 'bike-1' },
      });
      expect(result).toEqual(mockPref);
    });

    it('should return null when no preference exists', async () => {
      const bike = { id: 'bike-1' };
      (mockPrisma.bikeNotificationPreference.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await resolver(bike as never, {}, {} as never);

      expect(result).toBeNull();
    });
  });

  describe('rides query with bikeId filter', () => {
    const query = resolvers.Query.rides;

    it('should throw Unauthorized when user is not authenticated', async () => {
      const ctx = createMockContext(null);

      await expect(
        query({}, { take: 10 }, ctx as never)
      ).rejects.toThrow('Unauthorized');

      expect(mockPrisma.ride.findMany).not.toHaveBeenCalled();
    });

    it('should filter rides by bike owned by user', async () => {
      const ctx = createMockContext('user-123');
      const mockRides = [
        { id: 'ride-1', userId: 'user-123', bikeId: 'bike-1' },
        { id: 'ride-2', userId: 'user-123', bikeId: 'bike-1' },
      ];

      // Mock bike ownership check
      mockPrisma.bike.findUnique.mockResolvedValue({
        id: 'bike-1',
        userId: 'user-123',
      } as never);

      mockPrisma.ride.findMany.mockResolvedValue(mockRides as never);

      const result = await query(
        {},
        { take: 10, filter: { bikeId: 'bike-1' } },
        ctx as never
      );

      expect(mockPrisma.bike.findUnique).toHaveBeenCalledWith({
        where: { id: 'bike-1' },
        select: { userId: true },
      });
      expect(mockPrisma.ride.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-123',
            bikeId: 'bike-1',
          }),
        })
      );
      expect(result).toEqual(mockRides);
    });

    it('should reject bike not owned by user', async () => {
      const ctx = createMockContext('user-123');

      // Mock bike owned by different user
      mockPrisma.bike.findUnique.mockResolvedValue({
        id: 'bike-1',
        userId: 'other-user',
      } as never);

      await expect(
        query({}, { take: 10, filter: { bikeId: 'bike-1' } }, ctx as never)
      ).rejects.toThrow('Bike not found');

      expect(mockPrisma.bike.findUnique).toHaveBeenCalledWith({
        where: { id: 'bike-1' },
        select: { userId: true },
      });
      expect(mockPrisma.ride.findMany).not.toHaveBeenCalled();
    });

    it('should reject non-existent bike', async () => {
      const ctx = createMockContext('user-123');

      // Mock bike not found
      mockPrisma.bike.findUnique.mockResolvedValue(null);

      await expect(
        query({}, { take: 10, filter: { bikeId: 'non-existent-bike' } }, ctx as never)
      ).rejects.toThrow('Bike not found');

      expect(mockPrisma.bike.findUnique).toHaveBeenCalledWith({
        where: { id: 'non-existent-bike' },
        select: { userId: true },
      });
      expect(mockPrisma.ride.findMany).not.toHaveBeenCalled();
    });

    it('should work without bikeId filter', async () => {
      const ctx = createMockContext('user-123');
      const mockRides = [
        { id: 'ride-1', userId: 'user-123' },
        { id: 'ride-2', userId: 'user-123' },
      ];

      mockPrisma.ride.findMany.mockResolvedValue(mockRides as never);

      const result = await query({}, { take: 10 }, ctx as never);

      // Should not check bike ownership when no filter
      expect(mockPrisma.bike.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.ride.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-123' },
        })
      );
      expect(result).toEqual(mockRides);
    });
  });

  // =========================================================================
  // installComponent
  // =========================================================================
  describe('installComponent', () => {
    const mutation = resolvers.Mutation.installComponent;

    // Helper to create a mock transaction client matching the Prisma mock shape
    const createMockTx = () => ({
      component: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      bikeComponentInstall: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      serviceLog: {
        create: jest.fn().mockResolvedValue({ id: 'log-1' }),
      },
    });

    describe('authorization', () => {
      it('should throw Unauthorized when user is not authenticated', async () => {
        const ctx = createMockContext(null);

        await expect(
          mutation(
            {},
            { input: { bikeId: 'bike-1', slotKey: 'FORK_NONE', newComponent: { brand: 'Fox', model: '36' } } },
            ctx as never
          )
        ).rejects.toThrow('Unauthorized');
      });
    });

    describe('validation', () => {
      it('should reject when neither existingComponentId nor newComponent provided', async () => {
        const ctx = createMockContext('user-123');

        await expect(
          mutation(
            {},
            { input: { bikeId: 'bike-1', slotKey: 'FORK_NONE' } },
            ctx as never
          )
        ).rejects.toThrow('Must provide either existingComponentId or newComponent');
      });

      it('should reject when both existingComponentId and newComponent provided', async () => {
        const ctx = createMockContext('user-123');

        await expect(
          mutation(
            {},
            {
              input: {
                bikeId: 'bike-1',
                slotKey: 'FORK_NONE',
                existingComponentId: 'comp-1',
                newComponent: { brand: 'Fox', model: '36' },
              },
            },
            ctx as never
          )
        ).rejects.toThrow('Provide only one of existingComponentId or newComponent');
      });

      it('should reject when bike is not found', async () => {
        const ctx = createMockContext('user-123');
        (mockPrisma.bike.findFirst as jest.Mock).mockResolvedValue(null);

        await expect(
          mutation(
            {},
            { input: { bikeId: 'bike-1', slotKey: 'FORK_NONE', newComponent: { brand: 'Fox', model: '36' } } },
            ctx as never
          )
        ).rejects.toThrow('Bike not found');
      });

      it('should reject when existing component type does not match slot', async () => {
        const ctx = createMockContext('user-123');
        (mockPrisma.bike.findFirst as jest.Mock).mockResolvedValue({ id: 'bike-1', userId: 'user-123' });
        mockPrisma.component.findFirst.mockResolvedValue({
          id: 'comp-1',
          userId: 'user-123',
          type: 'SHOCK', // SHOCK != FORK
          bikeId: null,
        } as never);

        await expect(
          mutation(
            {},
            { input: { bikeId: 'bike-1', slotKey: 'FORK_NONE', existingComponentId: 'comp-1' } },
            ctx as never
          )
        ).rejects.toThrow('Component type does not match slot');
      });

      it('should reject when existing component is not owned by user', async () => {
        const ctx = createMockContext('user-123');
        (mockPrisma.bike.findFirst as jest.Mock).mockResolvedValue({ id: 'bike-1', userId: 'user-123' });
        // findFirst with { id, userId } returns null because different user
        mockPrisma.component.findFirst.mockResolvedValue(null);

        await expect(
          mutation(
            {},
            { input: { bikeId: 'bike-1', slotKey: 'FORK_NONE', existingComponentId: 'comp-1' } },
            ctx as never
          )
        ).rejects.toThrow('Component not found');
      });
    });

    describe('install spare onto occupied slot', () => {
      it('should displace current component and install spare', async () => {
        const ctx = createMockContext('user-123');
        const mockTx = createMockTx();

        // Bike exists
        (mockPrisma.bike.findFirst as jest.Mock).mockResolvedValue({ id: 'bike-1', userId: 'user-123' });

        // Existing spare component (INVENTORY, no bikeId)
        const spareComponent = {
          id: 'spare-1',
          userId: 'user-123',
          type: 'FORK',
          bikeId: null,
          status: 'INVENTORY',
        };
        mockPrisma.component.findFirst.mockResolvedValue(spareComponent as never);

        // Transaction: current install exists on the slot
        const currentInstall = { id: 'install-1', componentId: 'old-comp-1', bikeId: 'bike-1', slotKey: 'FORK_NONE' };
        mockTx.bikeComponentInstall.findFirst.mockResolvedValue(currentInstall as never);

        // Displaced component update
        const displacedComp = { id: 'old-comp-1', bikeId: null, status: 'INVENTORY' };
        mockTx.component.update
          .mockResolvedValueOnce(displacedComp as never) // displaced component
          .mockResolvedValueOnce({ ...spareComponent, bikeId: 'bike-1', status: 'INSTALLED' } as never); // spare installed

        mockTx.bikeComponentInstall.update.mockResolvedValue({} as never);
        mockTx.bikeComponentInstall.create.mockResolvedValue({} as never);

        mockPrisma.$transaction.mockImplementation(async (fn) => {
          if (typeof fn === 'function') return fn(mockTx);
          return [];
        });

        const result = await mutation(
          {},
          { input: { bikeId: 'bike-1', slotKey: 'FORK_NONE', existingComponentId: 'spare-1' } },
          ctx as never
        );

        // Should close the current install
        expect(mockTx.bikeComponentInstall.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'install-1' },
            data: expect.objectContaining({ removedAt: expect.any(Date) }),
          })
        );

        // Displaced component becomes INVENTORY
        expect(mockTx.component.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'old-comp-1' },
            data: expect.objectContaining({ bikeId: null, status: 'INVENTORY' }),
          })
        );

        // New install record created
        expect(mockTx.bikeComponentInstall.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              userId: 'user-123',
              bikeId: 'bike-1',
              componentId: 'spare-1',
              slotKey: 'FORK_NONE',
            }),
          })
        );

        // Prediction cache invalidated
        expect(invalidateBikePrediction).toHaveBeenCalledWith('user-123', 'bike-1');

        expect(result.displacedComponent).toBeTruthy();
        expect(result.installedComponent).toBeTruthy();
      });
    });

    describe('install new component onto occupied slot', () => {
      it('should retire current component and create new one', async () => {
        const ctx = createMockContext('user-123');
        const mockTx = createMockTx();

        (mockPrisma.bike.findFirst as jest.Mock).mockResolvedValue({ id: 'bike-1', userId: 'user-123' });

        // Current install exists
        const currentInstall = { id: 'install-1', componentId: 'old-comp-1', bikeId: 'bike-1', slotKey: 'FORK_NONE' };
        mockTx.bikeComponentInstall.findFirst.mockResolvedValue(currentInstall as never);

        // Displaced component is RETIRED when using newComponent
        const retiredComp = { id: 'old-comp-1', bikeId: null, status: 'RETIRED' };
        mockTx.component.update
          .mockResolvedValueOnce(retiredComp as never) // displaced → RETIRED
          .mockResolvedValueOnce({} as never); // replacedById update

        const newComp = { id: 'new-comp-1', type: 'FORK', brand: 'Fox', model: '36', status: 'INSTALLED', bikeId: 'bike-1' };
        mockTx.component.create.mockResolvedValue(newComp as never);

        mockTx.bikeComponentInstall.update.mockResolvedValue({} as never);
        mockTx.bikeComponentInstall.create.mockResolvedValue({} as never);

        mockPrisma.$transaction.mockImplementation(async (fn) => {
          if (typeof fn === 'function') return fn(mockTx);
          return [];
        });

        const result = await mutation(
          {},
          { input: { bikeId: 'bike-1', slotKey: 'FORK_NONE', newComponent: { brand: 'Fox', model: '36' } } },
          ctx as never
        );

        // Displaced component should be RETIRED
        expect(mockTx.component.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'old-comp-1' },
            data: expect.objectContaining({ status: 'RETIRED', retiredAt: expect.any(Date) }),
          })
        );

        // New component created with INSTALLED status
        expect(mockTx.component.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              brand: 'Fox',
              model: '36',
              status: 'INSTALLED',
              bikeId: 'bike-1',
              type: 'FORK',
            }),
          })
        );

        // replacedById set on displaced component
        expect(mockTx.component.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'old-comp-1' },
            data: expect.objectContaining({ replacedById: 'new-comp-1' }),
          })
        );

        expect(result.installedComponent).toEqual(newComp);
        expect(result.displacedComponent).toEqual(retiredComp);
      });
    });

    describe('install component from another bike', () => {
      it('should uninstall from source bike and install on target bike', async () => {
        const ctx = createMockContext('user-123');
        const mockTx = createMockTx();

        (mockPrisma.bike.findFirst as jest.Mock).mockResolvedValue({ id: 'bike-2', userId: 'user-123' });

        // Existing component is installed on bike-1
        const existingComp = {
          id: 'comp-1',
          userId: 'user-123',
          type: 'FORK',
          bikeId: 'bike-1',
          status: 'INSTALLED',
        };
        mockPrisma.component.findFirst.mockResolvedValue(existingComp as never);

        // Source install found for the existing component
        const sourceInstall = { id: 'source-install-1', componentId: 'comp-1', bikeId: 'bike-1' };
        mockTx.bikeComponentInstall.findFirst
          .mockResolvedValueOnce(sourceInstall as never) // source install for existing component
          .mockResolvedValueOnce(null as never); // no current install on target slot

        mockTx.bikeComponentInstall.update.mockResolvedValue({} as never);
        mockTx.component.update
          .mockResolvedValueOnce({ ...existingComp, bikeId: null, status: 'INVENTORY' } as never) // uninstall from source
          .mockResolvedValueOnce({ ...existingComp, bikeId: 'bike-2', status: 'INSTALLED' } as never); // install on target
        mockTx.bikeComponentInstall.create.mockResolvedValue({} as never);

        mockPrisma.$transaction.mockImplementation(async (fn) => {
          if (typeof fn === 'function') return fn(mockTx);
          return [];
        });

        await mutation(
          {},
          { input: { bikeId: 'bike-2', slotKey: 'FORK_NONE', existingComponentId: 'comp-1' } },
          ctx as never
        );

        // Source install should be closed
        expect(mockTx.bikeComponentInstall.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'source-install-1' },
            data: expect.objectContaining({ removedAt: expect.any(Date) }),
          })
        );

        // Both bikes' prediction caches invalidated
        expect(invalidateBikePrediction).toHaveBeenCalledWith('user-123', 'bike-1');
        expect(invalidateBikePrediction).toHaveBeenCalledWith('user-123', 'bike-2');
      });
    });
  });

  // =========================================================================
  // swapComponents
  // =========================================================================
  describe('swapComponents', () => {
    const mutation = resolvers.Mutation.swapComponents;

    const createMockTx = () => ({
      component: {
        update: jest.fn(),
      },
      bikeComponentInstall: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    });

    describe('authorization', () => {
      it('should throw Unauthorized when user is not authenticated', async () => {
        const ctx = createMockContext(null);

        await expect(
          mutation(
            {},
            {
              input: {
                bikeIdA: 'bike-1',
                slotKeyA: 'FORK_NONE',
                bikeIdB: 'bike-2',
                slotKeyB: 'FORK_NONE',
              },
            },
            ctx as never
          )
        ).rejects.toThrow('Unauthorized');
      });
    });

    describe('validation', () => {
      it('should reject when first bike is not found', async () => {
        const ctx = createMockContext('user-123');
        (mockPrisma.bike.findFirst as jest.Mock).mockResolvedValue(null);

        await expect(
          mutation(
            {},
            {
              input: {
                bikeIdA: 'bike-1',
                slotKeyA: 'FORK_NONE',
                bikeIdB: 'bike-2',
                slotKeyB: 'FORK_NONE',
              },
            },
            ctx as never
          )
        ).rejects.toThrow('bike not found');
      });

      it('should reject when component types do not match', async () => {
        const ctx = createMockContext('user-123');
        (mockPrisma.bike.findFirst as jest.Mock)
          .mockResolvedValueOnce({ id: 'bike-1', userId: 'user-123' })
          .mockResolvedValueOnce({ id: 'bike-2', userId: 'user-123' });

        await expect(
          mutation(
            {},
            {
              input: {
                bikeIdA: 'bike-1',
                slotKeyA: 'FORK_NONE',
                bikeIdB: 'bike-2',
                slotKeyB: 'SHOCK_NONE', // Different type
              },
            },
            ctx as never
          )
        ).rejects.toThrow('Cannot swap components of different types');
      });
    });

    describe('happy path', () => {
      it('should swap same-type components between two bikes', async () => {
        const ctx = createMockContext('user-123');
        const mockTx = createMockTx();

        (mockPrisma.bike.findFirst as jest.Mock)
          .mockResolvedValueOnce({ id: 'bike-1', userId: 'user-123' })
          .mockResolvedValueOnce({ id: 'bike-2', userId: 'user-123' });

        const installA = { id: 'install-a', componentId: 'comp-a', bikeId: 'bike-1', slotKey: 'FORK_NONE' };
        const installB = { id: 'install-b', componentId: 'comp-b', bikeId: 'bike-2', slotKey: 'FORK_NONE' };

        mockTx.bikeComponentInstall.findFirst
          .mockResolvedValueOnce(installA as never)
          .mockResolvedValueOnce(installB as never);

        const updatedA = { id: 'comp-a', bikeId: 'bike-2', type: 'FORK', location: 'NONE' };
        const updatedB = { id: 'comp-b', bikeId: 'bike-1', type: 'FORK', location: 'NONE' };
        mockTx.component.update
          .mockResolvedValueOnce(updatedA as never)
          .mockResolvedValueOnce(updatedB as never);

        mockTx.bikeComponentInstall.update.mockResolvedValue({} as never);
        mockTx.bikeComponentInstall.create.mockResolvedValue({} as never);

        mockPrisma.$transaction.mockImplementation(async (fn) => {
          if (typeof fn === 'function') return fn(mockTx);
          return [];
        });

        const result = await mutation(
          {},
          {
            input: {
              bikeIdA: 'bike-1',
              slotKeyA: 'FORK_NONE',
              bikeIdB: 'bike-2',
              slotKeyB: 'FORK_NONE',
            },
          },
          ctx as never
        );

        // Both installs should be closed
        expect(mockTx.bikeComponentInstall.update).toHaveBeenCalledTimes(2);

        // Component A now on bike B
        expect(mockTx.component.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'comp-a' },
            data: expect.objectContaining({ bikeId: 'bike-2' }),
          })
        );

        // Component B now on bike A
        expect(mockTx.component.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'comp-b' },
            data: expect.objectContaining({ bikeId: 'bike-1' }),
          })
        );

        // Two new install records created
        expect(mockTx.bikeComponentInstall.create).toHaveBeenCalledTimes(2);

        // Prediction caches invalidated for both bikes
        expect(invalidateBikePrediction).toHaveBeenCalledWith('user-123', 'bike-1');
        expect(invalidateBikePrediction).toHaveBeenCalledWith('user-123', 'bike-2');

        expect(result.componentA).toEqual(updatedA);
        expect(result.componentB).toEqual(updatedB);
      });

      it('should reject when slot A has no component installed', async () => {
        const ctx = createMockContext('user-123');
        const mockTx = createMockTx();

        (mockPrisma.bike.findFirst as jest.Mock)
          .mockResolvedValueOnce({ id: 'bike-1', userId: 'user-123' })
          .mockResolvedValueOnce({ id: 'bike-2', userId: 'user-123' });

        // No install found for slot A
        mockTx.bikeComponentInstall.findFirst
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'install-b' } as never);

        mockPrisma.$transaction.mockImplementation(async (fn) => {
          if (typeof fn === 'function') return fn(mockTx);
          return [];
        });

        await expect(
          mutation(
            {},
            {
              input: {
                bikeIdA: 'bike-1',
                slotKeyA: 'FORK_NONE',
                bikeIdB: 'bike-2',
                slotKeyB: 'FORK_NONE',
              },
            },
            ctx as never
          )
        ).rejects.toThrow('No component installed in the first slot');
      });

      it('should reject when slot B has no component installed', async () => {
        const ctx = createMockContext('user-123');
        const mockTx = createMockTx();

        (mockPrisma.bike.findFirst as jest.Mock)
          .mockResolvedValueOnce({ id: 'bike-1', userId: 'user-123' })
          .mockResolvedValueOnce({ id: 'bike-2', userId: 'user-123' });

        // Install found for A, but not for B
        mockTx.bikeComponentInstall.findFirst
          .mockResolvedValueOnce({ id: 'install-a' } as never)
          .mockResolvedValueOnce(null);

        mockPrisma.$transaction.mockImplementation(async (fn) => {
          if (typeof fn === 'function') return fn(mockTx);
          return [];
        });

        await expect(
          mutation(
            {},
            {
              input: {
                bikeIdA: 'bike-1',
                slotKeyA: 'FORK_NONE',
                bikeIdB: 'bike-2',
                slotKeyB: 'FORK_NONE',
              },
            },
            ctx as never
          )
        ).rejects.toThrow('No component installed in the second slot');
      });
    });
  });

  describe('bikes query', () => {
    const query = resolvers.Query.bikes;

    it('should throw Unauthorized when user is not authenticated', async () => {
      const ctx = createMockContext(null);
      await expect(query({}, {}, ctx as never)).rejects.toThrow('Unauthorized');
    });

    it('should only return ACTIVE bikes by default', async () => {
      const ctx = createMockContext('user-123');
      mockPrisma.bike.findMany.mockResolvedValue([] as never);

      await query({}, {}, ctx as never);

      expect(mockPrisma.bike.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-123', status: 'ACTIVE' },
        })
      );
    });

    it('should return all bikes when includeInactive is true', async () => {
      const ctx = createMockContext('user-123');
      mockPrisma.bike.findMany.mockResolvedValue([] as never);

      await query({}, { includeInactive: true }, ctx as never);

      expect(mockPrisma.bike.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-123' },
        })
      );
    });
  });

  describe('retireBike', () => {
    const mutation = resolvers.Mutation.retireBike;

    describe('authorization', () => {
      it('should throw Unauthorized when user is not authenticated', async () => {
        const ctx = createMockContext(null);
        await expect(
          mutation({}, { id: 'bike-1', status: 'RETIRED' }, ctx as never)
        ).rejects.toThrow('Unauthorized');
      });

      it('should throw when bike does not exist', async () => {
        const ctx = createMockContext('user-123');
        mockPrisma.bike.findUnique.mockResolvedValue(null as never);

        await expect(
          mutation({}, { id: 'bike-1', status: 'RETIRED' }, ctx as never)
        ).rejects.toThrow('Bike not found');
      });

      it('should throw when bike belongs to another user', async () => {
        const ctx = createMockContext('user-123');
        mockPrisma.bike.findUnique.mockResolvedValue({ userId: 'other-user', retiredAt: null } as never);

        await expect(
          mutation({}, { id: 'bike-1', status: 'RETIRED' }, ctx as never)
        ).rejects.toThrow('Bike not found');
      });
    });

    describe('happy path', () => {
      it('should set status to RETIRED and retiredAt', async () => {
        const ctx = createMockContext('user-123');
        mockPrisma.bike.findUnique.mockResolvedValue({ userId: 'user-123', retiredAt: null } as never);
        mockPrisma.bike.update.mockResolvedValue({ id: 'bike-1', status: 'RETIRED' } as never);

        await mutation({}, { id: 'bike-1', status: 'RETIRED' }, ctx as never);

        expect(mockPrisma.bike.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'bike-1' },
            data: expect.objectContaining({
              status: 'RETIRED',
              retiredAt: expect.any(Date),
            }),
          })
        );
      });

      it('should set status to SOLD', async () => {
        const ctx = createMockContext('user-123');
        mockPrisma.bike.findUnique.mockResolvedValue({ userId: 'user-123', retiredAt: null } as never);
        mockPrisma.bike.update.mockResolvedValue({ id: 'bike-1', status: 'SOLD' } as never);

        await mutation({}, { id: 'bike-1', status: 'SOLD' }, ctx as never);

        expect(mockPrisma.bike.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ status: 'SOLD' }),
          })
        );
      });
    });

    describe('double-call behavior', () => {
      it('should preserve original retiredAt when called again', async () => {
        const originalDate = new Date('2025-01-15T00:00:00Z');
        const ctx = createMockContext('user-123');
        mockPrisma.bike.findUnique.mockResolvedValue({ userId: 'user-123', retiredAt: originalDate } as never);
        mockPrisma.bike.update.mockResolvedValue({ id: 'bike-1', status: 'SOLD' } as never);

        await mutation({}, { id: 'bike-1', status: 'SOLD' }, ctx as never);

        expect(mockPrisma.bike.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: 'SOLD',
              retiredAt: originalDate,
            }),
          })
        );
      });
    });
  });

  describe('reactivateBike', () => {
    const mutation = resolvers.Mutation.reactivateBike;

    it('should throw Unauthorized when user is not authenticated', async () => {
      const ctx = createMockContext(null);
      await expect(
        mutation({}, { id: 'bike-1' }, ctx as never)
      ).rejects.toThrow('Unauthorized');
    });

    it('should throw when bike belongs to another user', async () => {
      const ctx = createMockContext('user-123');
      mockPrisma.bike.findUnique.mockResolvedValue({ userId: 'other-user' } as never);

      await expect(
        mutation({}, { id: 'bike-1' }, ctx as never)
      ).rejects.toThrow('Bike not found');
    });

    it('should set status to ACTIVE and clear retiredAt', async () => {
      const ctx = createMockContext('user-123');
      mockPrisma.bike.findUnique.mockResolvedValue({ userId: 'user-123' } as never);
      mockPrisma.bike.update.mockResolvedValue({ id: 'bike-1', status: 'ACTIVE' } as never);

      await mutation({}, { id: 'bike-1' }, ctx as never);

      expect(mockPrisma.bike.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'bike-1' },
          data: { status: 'ACTIVE', retiredAt: null },
        })
      );
    });
  });

  describe('deleteBike', () => {
    const mutation = resolvers.Mutation.deleteBike;

    it('should throw Unauthorized when user is not authenticated', async () => {
      const ctx = createMockContext(null);
      await expect(
        mutation({}, { id: 'bike-1' }, ctx as never)
      ).rejects.toThrow('Unauthorized');
    });

    it('should throw when bike belongs to another user', async () => {
      const ctx = createMockContext('user-123');
      mockPrisma.bike.findUnique.mockResolvedValue({ userId: 'other-user' } as never);

      await expect(
        mutation({}, { id: 'bike-1' }, ctx as never)
      ).rejects.toThrow('Bike not found');
    });

    it('should delete bike and associated data in a transaction', async () => {
      const ctx = createMockContext('user-123');
      mockPrisma.bike.findUnique.mockResolvedValue({ userId: 'user-123' } as never);

      const mockTx = {
        component: { deleteMany: jest.fn() },
        ride: { updateMany: jest.fn() },
        stravaGearMapping: { deleteMany: jest.fn() },
        bike: { delete: jest.fn() },
      };
      mockPrisma.$transaction.mockImplementation(async (fn) => {
        if (typeof fn === 'function') return fn(mockTx as never);
        return [];
      });

      const result = await mutation({}, { id: 'bike-1' }, ctx as never);

      expect(result).toEqual({ ok: true, id: 'bike-1' });
      expect(mockTx.component.deleteMany).toHaveBeenCalledWith({ where: { bikeId: 'bike-1' } });
      expect(mockTx.ride.updateMany).toHaveBeenCalledWith({
        where: { bikeId: 'bike-1' },
        data: { bikeId: null },
      });
      expect(mockTx.stravaGearMapping.deleteMany).toHaveBeenCalledWith({ where: { bikeId: 'bike-1' } });
      expect(mockTx.bike.delete).toHaveBeenCalledWith({ where: { id: 'bike-1' } });
    });
  });

  describe('updateUserPreferences', () => {
    const mutation = resolvers.Mutation.updateUserPreferences;

    it('should update expoPushToken', async () => {
      const ctx = createMockContext();
      (mockPrisma.user.update as jest.Mock).mockResolvedValue({ id: 'user-123' });

      await mutation(null, { input: { expoPushToken: 'ExponentPushToken[abc]' } }, ctx);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { expoPushToken: 'ExponentPushToken[abc]' },
      });
    });

    it('should update notifyOnRideUpload', async () => {
      const ctx = createMockContext();
      (mockPrisma.user.update as jest.Mock).mockResolvedValue({ id: 'user-123' });

      await mutation(null, { input: { notifyOnRideUpload: false } }, ctx);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { notifyOnRideUpload: false },
      });
    });

    it('should reject expoPushToken exceeding max length', async () => {
      const ctx = createMockContext();
      const longToken = 'a'.repeat(201);

      await expect(
        mutation(null, { input: { expoPushToken: longToken } }, ctx)
      ).rejects.toThrow('expoPushToken exceeds maximum length');
    });

    it('should reject expoPushToken with invalid format', async () => {
      const ctx = createMockContext();

      await expect(
        mutation(null, { input: { expoPushToken: 'not-a-valid-token' } }, ctx)
      ).rejects.toThrow('expoPushToken is not a valid Expo push token');
    });

    it('should allow clearing expoPushToken with null', async () => {
      const ctx = createMockContext();
      (mockPrisma.user.update as jest.Mock).mockResolvedValue({ id: 'user-123' });

      await mutation(null, { input: { expoPushToken: null } }, ctx);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { expoPushToken: null },
      });
    });
  });

  describe('updateBikeNotificationPreference', () => {
    const mutation = resolvers.Mutation.updateBikeNotificationPreference;

    it('should upsert notification preference for owned bike', async () => {
      const ctx = createMockContext();
      (mockPrisma.bike.findUnique as jest.Mock).mockResolvedValue({ userId: 'user-123' });
      (mockPrisma.bikeNotificationPreference.upsert as jest.Mock).mockResolvedValue({
        bikeId: 'bike-1',
        serviceNotificationsEnabled: false,
        serviceNotificationMode: 'RIDES_BEFORE',
        serviceNotificationThreshold: 3,
      });

      const result = await mutation(
        null,
        { input: { bikeId: 'bike-1', serviceNotificationsEnabled: false } },
        ctx
      );

      expect(mockPrisma.bikeNotificationPreference.upsert).toHaveBeenCalledWith({
        where: { bikeId: 'bike-1' },
        create: { bikeId: 'bike-1', serviceNotificationsEnabled: false },
        update: { serviceNotificationsEnabled: false },
      });
      expect(result.serviceNotificationsEnabled).toBe(false);
    });

    it('should reject if bike not found', async () => {
      const ctx = createMockContext();
      (mockPrisma.bike.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        mutation(null, { input: { bikeId: 'bike-999' } }, ctx)
      ).rejects.toThrow('Bike not found');
    });

    it('should reject if bike belongs to another user', async () => {
      const ctx = createMockContext();
      (mockPrisma.bike.findUnique as jest.Mock).mockResolvedValue({ userId: 'other-user' });

      await expect(
        mutation(null, { input: { bikeId: 'bike-1' } }, ctx)
      ).rejects.toThrow('Bike not found');
    });

    it('should reject invalid serviceNotificationMode', async () => {
      const ctx = createMockContext();
      (mockPrisma.bike.findUnique as jest.Mock).mockResolvedValue({ userId: 'user-123' });

      await expect(
        mutation(
          null,
          { input: { bikeId: 'bike-1', serviceNotificationMode: 'INVALID_MODE' } },
          ctx
        )
      ).rejects.toThrow('Invalid serviceNotificationMode');
    });

    it('should reject threshold below 1', async () => {
      const ctx = createMockContext();
      (mockPrisma.bike.findUnique as jest.Mock).mockResolvedValue({ userId: 'user-123' });

      await expect(
        mutation(
          null,
          { input: { bikeId: 'bike-1', serviceNotificationThreshold: 0 } },
          ctx
        )
      ).rejects.toThrow('serviceNotificationThreshold must be between 1 and 100');
    });

    it('should reject threshold above 100', async () => {
      const ctx = createMockContext();
      (mockPrisma.bike.findUnique as jest.Mock).mockResolvedValue({ userId: 'user-123' });

      await expect(
        mutation(
          null,
          { input: { bikeId: 'bike-1', serviceNotificationThreshold: 101 } },
          ctx
        )
      ).rejects.toThrow('serviceNotificationThreshold must be between 1 and 100');
    });

    it('should update serviceNotificationMode', async () => {
      const ctx = createMockContext();
      (mockPrisma.bike.findUnique as jest.Mock).mockResolvedValue({ userId: 'user-123' });
      (mockPrisma.bikeNotificationPreference.upsert as jest.Mock).mockResolvedValue({
        bikeId: 'bike-1',
        serviceNotificationsEnabled: true,
        serviceNotificationMode: 'HOURS_BEFORE',
        serviceNotificationThreshold: 3,
      });

      await mutation(
        null,
        { input: { bikeId: 'bike-1', serviceNotificationMode: 'HOURS_BEFORE' } },
        ctx
      );

      expect(mockPrisma.bikeNotificationPreference.upsert).toHaveBeenCalledWith({
        where: { bikeId: 'bike-1' },
        create: { bikeId: 'bike-1', serviceNotificationMode: 'HOURS_BEFORE' },
        update: { serviceNotificationMode: 'HOURS_BEFORE' },
      });
    });

    it('should update serviceNotificationThreshold', async () => {
      const ctx = createMockContext();
      (mockPrisma.bike.findUnique as jest.Mock).mockResolvedValue({ userId: 'user-123' });
      (mockPrisma.bikeNotificationPreference.upsert as jest.Mock).mockResolvedValue({
        bikeId: 'bike-1',
        serviceNotificationsEnabled: true,
        serviceNotificationMode: 'RIDES_BEFORE',
        serviceNotificationThreshold: 5,
      });

      await mutation(
        null,
        { input: { bikeId: 'bike-1', serviceNotificationThreshold: 5 } },
        ctx
      );

      expect(mockPrisma.bikeNotificationPreference.upsert).toHaveBeenCalledWith({
        where: { bikeId: 'bike-1' },
        create: { bikeId: 'bike-1', serviceNotificationThreshold: 5 },
        update: { serviceNotificationThreshold: 5 },
      });
    });
  });

  describe('logComponentService - notification dedup reset', () => {
    const mutation = resolvers.Mutation.logComponentService;

    it('should clear notification logs after servicing a component', async () => {
      const ctx = createMockContext();
      const { clearServiceNotificationLogs } = jest.requireMock<typeof import('../../services/notification.service')>('../../services/notification.service');

      (mockPrisma.component.findUnique as jest.Mock).mockResolvedValue({
        userId: 'user-123',
        bikeId: 'bike-1',
        hoursUsed: 50,
      });

      const mockTx = {
        serviceLog: { create: jest.fn() },
        component: { update: jest.fn().mockResolvedValue({ id: 'comp-1' }) },
      };
      (mockPrisma.$transaction as jest.Mock).mockImplementation((fn: (...args: unknown[]) => unknown) => fn(mockTx));

      await mutation(null, { id: 'comp-1' }, ctx);

      expect(clearServiceNotificationLogs).toHaveBeenCalledWith('comp-1', 'user-123');
    });
  });

  describe('Mutation.updateServiceLog', () => {
    const mutation = resolvers.Mutation.updateServiceLog;
    const mockLogFindUnique = mockPrisma.serviceLog.findUnique as jest.Mock;
    const mockLogFindFirst = mockPrisma.serviceLog.findFirst as jest.Mock;
    const mockLogUpdate = mockPrisma.serviceLog.update as jest.Mock;
    const mockComponentFindUnique = mockPrisma.component.findUnique as jest.Mock;
    const mockComponentUpdate = mockPrisma.component.update as jest.Mock;
    const mockRideAggregate = mockPrisma.ride.aggregate as jest.Mock;
    const mockTransaction = mockPrisma.$transaction as jest.Mock;

    // Build a tx client that mirrors the module-level prisma mock so the
    // resolver's inner transaction calls hit the same jest functions we
    // assert against.
    const setTransactionPassthrough = () => {
      mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
        const tx = {
          serviceLog: {
            findFirst: mockLogFindFirst,
            update: mockLogUpdate,
            delete: mockPrisma.serviceLog.delete,
          },
          component: {
            findUnique: mockComponentFindUnique,
            update: mockComponentUpdate,
          },
          ride: { aggregate: mockRideAggregate },
        };
        return fn(tx);
      });
    };

    beforeEach(() => {
      mockLogFindUnique.mockReset();
      mockLogFindFirst.mockReset();
      mockLogUpdate.mockReset().mockResolvedValue({ id: 'log-1' });
      mockComponentFindUnique.mockReset();
      mockComponentUpdate.mockReset().mockResolvedValue({ id: 'comp-1' });
      mockRideAggregate.mockReset().mockResolvedValue({ _sum: { durationSeconds: 0 } });
      mockTransaction.mockReset();
      setTransactionPassthrough();
    });

    it('rejects when the log component belongs to a different user', async () => {
      mockLogFindUnique.mockResolvedValueOnce({
        id: 'log-1',
        component: { id: 'comp-1', userId: 'other-user', bikeId: 'bike-1' },
      });
      const ctx = createMockContext('user-123');
      await expect(
        mutation({}, { id: 'log-1', input: { notes: 'hi' } }, ctx as never)
      ).rejects.toThrow('Service log not found');
      expect(mockLogUpdate).not.toHaveBeenCalled();
    });

    it('rejects hoursAtService above the upper cap', async () => {
      // Blocks wear-engine-blowing submissions like 1e15. The cap is
      // 100,000 — way above any realistic lifetime — so a normal user
      // never trips it, but bogus input fails fast instead of silently
      // skewing every downstream prediction.
      mockLogFindUnique.mockResolvedValueOnce({
        id: 'log-1',
        component: { id: 'comp-1', userId: 'user-123', bikeId: 'bike-1' },
      });
      const ctx = createMockContext('user-123');
      await expect(
        mutation({}, { id: 'log-1', input: { hoursAtService: 1e15 } }, ctx as never)
      ).rejects.toThrow('hoursAtService must be between 0 and 100000');
      expect(mockLogUpdate).not.toHaveBeenCalled();
    });

    it('does not touch component anchor when editing a non-latest log', async () => {
      mockLogFindUnique.mockResolvedValueOnce({
        id: 'log-old',
        component: { id: 'comp-1', userId: 'user-123', bikeId: 'bike-1' },
      });
      // Latest is a different log
      mockLogFindFirst.mockResolvedValueOnce({ id: 'log-newer', performedAt: new Date('2026-04-01') });

      const ctx = createMockContext('user-123');
      await mutation(
        {},
        { id: 'log-old', input: { notes: 'typo fixed' } },
        ctx as never
      );

      expect(mockLogUpdate).toHaveBeenCalledWith({
        where: { id: 'log-old' },
        data: { notes: 'typo fixed' },
      });
      // Non-latest + no date change → recompute helper should NOT run
      expect(mockComponentUpdate).not.toHaveBeenCalled();
      expect(mockRideAggregate).not.toHaveBeenCalled();
    });

    it('skips recompute when editing notes/hours on the latest log (no date change)', async () => {
      // Regression: previously the resolver recomputed on ANY edit to the
      // latest log. Metadata-only edits don't move the anchor, so we
      // shouldn't aggregate ride hours or touch Component.
      mockLogFindUnique.mockResolvedValueOnce({
        id: 'log-latest',
        component: { id: 'comp-1', userId: 'user-123', bikeId: 'bike-1' },
      });
      mockLogFindFirst.mockResolvedValueOnce({
        id: 'log-latest',
        performedAt: new Date('2026-03-01'),
      });

      const ctx = createMockContext('user-123');
      await mutation(
        {},
        { id: 'log-latest', input: { notes: 'updated notes' } },
        ctx as never
      );

      expect(mockLogUpdate).toHaveBeenCalledWith({
        where: { id: 'log-latest' },
        data: { notes: 'updated notes' },
      });
      expect(mockComponentUpdate).not.toHaveBeenCalled();
      expect(mockRideAggregate).not.toHaveBeenCalled();
    });

    it('skips recompute when a non-latest date shift stays behind the previous latest', async () => {
      // Regression: previously any date change triggered recompute. Moving
      // an old log forward a few days but still earlier than the latest log
      // leaves the anchor untouched, so no aggregate query is needed.
      mockLogFindUnique.mockResolvedValueOnce({
        id: 'log-old',
        component: { id: 'comp-1', userId: 'user-123', bikeId: 'bike-1' },
      });
      mockLogFindFirst.mockResolvedValueOnce({
        id: 'log-latest',
        performedAt: new Date('2026-04-01'),
      });

      const ctx = createMockContext('user-123');
      await mutation(
        {},
        { id: 'log-old', input: { performedAt: '2026-02-20T00:00:00.000Z' } },
        ctx as never
      );

      expect(mockLogUpdate).toHaveBeenCalled();
      expect(mockComponentUpdate).not.toHaveBeenCalled();
      expect(mockRideAggregate).not.toHaveBeenCalled();
    });

    it('recomputes when a non-latest log is moved past the previous latest', async () => {
      // A previously-non-latest log was moved forward to a date that now
      // beats the old latest — the anchor moves and the helper must run.
      mockLogFindUnique.mockResolvedValueOnce({
        id: 'log-old',
        component: { id: 'comp-1', userId: 'user-123', bikeId: 'bike-1' },
      });
      mockLogFindFirst
        .mockResolvedValueOnce({ id: 'log-latest', performedAt: new Date('2026-01-01') })
        // After the update, log-old is now the newest.
        .mockResolvedValueOnce({ performedAt: new Date('2026-03-10') });
      mockComponentFindUnique.mockResolvedValueOnce({ id: 'comp-1', bikeId: 'bike-1' });
      mockRideAggregate.mockResolvedValueOnce({ _sum: { durationSeconds: 3600 } });

      const ctx = createMockContext('user-123');
      await mutation(
        {},
        { id: 'log-old', input: { performedAt: '2026-03-10T00:00:00.000Z' } },
        ctx as never
      );

      expect(mockComponentUpdate).toHaveBeenCalledWith({
        where: { id: 'comp-1' },
        data: { lastServicedAt: new Date('2026-03-10'), hoursUsed: 1 },
      });
    });

    it('recomputes anchor + hoursUsed when editing the latest log date', async () => {
      mockLogFindUnique.mockResolvedValueOnce({
        id: 'log-latest',
        component: { id: 'comp-1', userId: 'user-123', bikeId: 'bike-1' },
      });
      // This log IS the latest
      mockLogFindFirst
        .mockResolvedValueOnce({ id: 'log-latest', performedAt: new Date('2026-03-01') })
        // Second call: recompute helper asks for the newest remaining log
        .mockResolvedValueOnce({ performedAt: new Date('2026-04-15') });
      mockComponentFindUnique.mockResolvedValueOnce({ id: 'comp-1', bikeId: 'bike-1' });
      mockRideAggregate.mockResolvedValueOnce({ _sum: { durationSeconds: 7200 } }); // 2 hours

      const ctx = createMockContext('user-123');
      await mutation(
        {},
        { id: 'log-latest', input: { performedAt: '2026-04-15T00:00:00.000Z' } },
        ctx as never
      );

      expect(mockRideAggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            bikeId: 'bike-1',
            startTime: { gte: new Date('2026-04-15') },
          }),
        })
      );
      expect(mockComponentUpdate).toHaveBeenCalledWith({
        where: { id: 'comp-1' },
        data: { lastServicedAt: new Date('2026-04-15'), hoursUsed: 2 },
      });
    });

    it('invalidates prediction cache before and after the transaction', async () => {
      mockLogFindUnique.mockResolvedValueOnce({
        id: 'log-1',
        component: { id: 'comp-1', userId: 'user-123', bikeId: 'bike-7' },
      });
      mockLogFindFirst.mockResolvedValue({ id: 'log-other', performedAt: new Date() });
      const ctx = createMockContext('user-123');

      await mutation({}, { id: 'log-1', input: { notes: 'x' } }, ctx as never);

      const calls = (invalidateBikePrediction as jest.Mock).mock.calls.filter(
        (c) => c[1] === 'bike-7'
      );
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Mutation.deleteServiceLog', () => {
    const mutation = resolvers.Mutation.deleteServiceLog;
    const mockLogFindUnique = mockPrisma.serviceLog.findUnique as jest.Mock;
    const mockLogFindFirst = mockPrisma.serviceLog.findFirst as jest.Mock;
    const mockLogDelete = mockPrisma.serviceLog.delete as jest.Mock;
    const mockComponentFindUnique = mockPrisma.component.findUnique as jest.Mock;
    const mockComponentUpdate = mockPrisma.component.update as jest.Mock;
    const mockRideAggregate = mockPrisma.ride.aggregate as jest.Mock;
    const mockTransaction = mockPrisma.$transaction as jest.Mock;

    const setTransactionPassthrough = () => {
      mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
        const tx = {
          serviceLog: {
            findFirst: mockLogFindFirst,
            update: mockPrisma.serviceLog.update,
            delete: mockLogDelete,
          },
          component: {
            findUnique: mockComponentFindUnique,
            update: mockComponentUpdate,
          },
          ride: { aggregate: mockRideAggregate },
        };
        return fn(tx);
      });
    };

    beforeEach(() => {
      mockLogFindUnique.mockReset();
      mockLogFindFirst.mockReset();
      mockLogDelete.mockReset().mockResolvedValue({ id: 'log-1' });
      mockComponentFindUnique.mockReset();
      mockComponentUpdate.mockReset().mockResolvedValue({ id: 'comp-1' });
      mockRideAggregate.mockReset().mockResolvedValue({ _sum: { durationSeconds: 0 } });
      mockTransaction.mockReset();
      setTransactionPassthrough();
    });

    it('rejects when the log is not owned by the viewer', async () => {
      mockLogFindUnique.mockResolvedValueOnce({
        id: 'log-1',
        component: { id: 'comp-1', userId: 'other-user', bikeId: 'bike-1' },
      });
      const ctx = createMockContext('user-123');

      await expect(
        mutation({}, { id: 'log-1' }, ctx as never)
      ).rejects.toThrow('Service log not found');
      expect(mockLogDelete).not.toHaveBeenCalled();
    });

    it('leaves the anchor alone when deleting a non-latest log', async () => {
      mockLogFindUnique.mockResolvedValueOnce({
        id: 'log-old',
        component: { id: 'comp-1', userId: 'user-123', bikeId: 'bike-1' },
      });
      mockLogFindFirst.mockResolvedValueOnce({ id: 'log-newer' });

      const ctx = createMockContext('user-123');
      await mutation({}, { id: 'log-old' }, ctx as never);

      expect(mockLogDelete).toHaveBeenCalledWith({ where: { id: 'log-old' } });
      expect(mockComponentUpdate).not.toHaveBeenCalled();
      expect(mockRideAggregate).not.toHaveBeenCalled();
    });

    it('rolls anchor back to the prior log when deleting the latest', async () => {
      mockLogFindUnique.mockResolvedValueOnce({
        id: 'log-latest',
        component: { id: 'comp-1', userId: 'user-123', bikeId: 'bike-1' },
      });
      mockLogFindFirst
        .mockResolvedValueOnce({ id: 'log-latest' }) // was latest
        .mockResolvedValueOnce({ performedAt: new Date('2026-01-01') }); // prior log after delete
      mockComponentFindUnique.mockResolvedValueOnce({ id: 'comp-1', bikeId: 'bike-1' });
      mockRideAggregate.mockResolvedValueOnce({ _sum: { durationSeconds: 18000 } }); // 5 hours

      const ctx = createMockContext('user-123');
      await mutation({}, { id: 'log-latest' }, ctx as never);

      expect(mockComponentUpdate).toHaveBeenCalledWith({
        where: { id: 'comp-1' },
        data: { lastServicedAt: new Date('2026-01-01'), hoursUsed: 5 },
      });
    });

    it('sets anchor to null when the last remaining log is deleted', async () => {
      mockLogFindUnique.mockResolvedValueOnce({
        id: 'log-last',
        component: { id: 'comp-1', userId: 'user-123', bikeId: 'bike-1' },
      });
      mockLogFindFirst
        .mockResolvedValueOnce({ id: 'log-last' })
        .mockResolvedValueOnce(null); // no remaining logs
      mockComponentFindUnique.mockResolvedValueOnce({ id: 'comp-1', bikeId: 'bike-1' });
      mockRideAggregate.mockResolvedValueOnce({ _sum: { durationSeconds: 360000 } }); // 100 hours

      const ctx = createMockContext('user-123');
      await mutation({}, { id: 'log-last' }, ctx as never);

      expect(mockRideAggregate).toHaveBeenCalledWith({
        where: { bikeId: 'bike-1' },
        _sum: { durationSeconds: true },
      });
      expect(mockComponentUpdate).toHaveBeenCalledWith({
        where: { id: 'comp-1' },
        data: { lastServicedAt: null, hoursUsed: 100 },
      });
    });

    it('clears notification dedup so overdue alerts can re-trigger', async () => {
      mockLogFindUnique.mockResolvedValueOnce({
        id: 'log-1',
        component: { id: 'comp-1', userId: 'user-123', bikeId: 'bike-1' },
      });
      mockLogFindFirst.mockResolvedValueOnce({ id: 'log-other' });
      const { clearServiceNotificationLogs } = jest.requireMock<typeof import('../../services/notification.service')>('../../services/notification.service');
      (clearServiceNotificationLogs as jest.Mock).mockClear();

      const ctx = createMockContext('user-123');
      await mutation({}, { id: 'log-1' }, ctx as never);

      expect(clearServiceNotificationLogs).toHaveBeenCalledWith('comp-1', 'user-123');
    });
  });

  describe('Mutation.updateBikeComponentInstall', () => {
    const mutation = resolvers.Mutation.updateBikeComponentInstall;
    const mockFindUnique = mockPrisma.bikeComponentInstall.findUnique as jest.Mock;
    const mockUpdate = mockPrisma.bikeComponentInstall.update as jest.Mock;

    beforeEach(() => {
      mockFindUnique.mockReset();
      mockUpdate.mockReset().mockResolvedValue({ id: 'install-1' });
    });

    it('rejects when the install belongs to a different user', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'install-1',
        userId: 'other-user',
        bikeId: 'bike-1',
      });
      const ctx = createMockContext('user-123');
      await expect(
        mutation({}, { id: 'install-1', input: { installedAt: '2026-01-01T00:00:00Z' } }, ctx as never)
      ).rejects.toThrow('Install record not found');
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('rejects future install dates', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'install-1',
        userId: 'user-123',
        bikeId: 'bike-1',
      });
      const future = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();
      const ctx = createMockContext('user-123');
      await expect(
        mutation({}, { id: 'install-1', input: { installedAt: future } }, ctx as never)
      ).rejects.toThrow('Install date cannot be in the future');
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('updates installedAt and invalidates prediction cache before and after', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'install-1',
        userId: 'user-123',
        bikeId: 'bike-7',
      });
      const ctx = createMockContext('user-123');

      await mutation(
        {},
        { id: 'install-1', input: { installedAt: '2025-06-01T00:00:00Z' } },
        ctx as never
      );

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'install-1' },
        data: { installedAt: new Date('2025-06-01T00:00:00Z') },
      });
      const calls = (invalidateBikePrediction as jest.Mock).mock.calls.filter(
        (c) => c[1] === 'bike-7'
      );
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });

    it('supports clearing removedAt with null', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'install-1',
        userId: 'user-123',
        bikeId: 'bike-1',
      });
      const ctx = createMockContext('user-123');

      await mutation(
        {},
        { id: 'install-1', input: { removedAt: null } },
        ctx as never
      );

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'install-1' },
        data: { removedAt: null },
      });
    });

    it('rejects a removedAt earlier than the existing installedAt', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'install-1',
        userId: 'user-123',
        bikeId: 'bike-1',
        installedAt: new Date('2026-03-01T00:00:00Z'),
      });
      const ctx = createMockContext('user-123');

      await expect(
        mutation(
          {},
          { id: 'install-1', input: { removedAt: '2026-02-15T00:00:00Z' } },
          ctx as never
        )
      ).rejects.toThrow('Removal date cannot be before install date');
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('rejects removedAt earlier than a same-mutation installedAt', async () => {
      // User is updating both fields at once — check the NEW installedAt,
      // not the persisted value, so we don't block a legitimate correction
      // that moves both dates together.
      mockFindUnique.mockResolvedValueOnce({
        id: 'install-1',
        userId: 'user-123',
        bikeId: 'bike-1',
        installedAt: new Date('2020-01-01T00:00:00Z'),
      });
      const ctx = createMockContext('user-123');

      await expect(
        mutation(
          {},
          {
            id: 'install-1',
            input: {
              installedAt: '2026-04-01T00:00:00Z',
              removedAt: '2026-03-15T00:00:00Z',
            },
          },
          ctx as never
        )
      ).rejects.toThrow('Removal date cannot be before install date');
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('rejects a new installedAt later than the existing removedAt', async () => {
      // Only installedAt is in the payload, but the row already has a
      // removedAt. Without guarding against the persisted removedAt, the
      // row ends up inverted (installed 2026-02, removed 2026-01).
      mockFindUnique.mockResolvedValueOnce({
        id: 'install-1',
        userId: 'user-123',
        bikeId: 'bike-1',
        installedAt: new Date('2025-06-01T00:00:00Z'),
        removedAt: new Date('2026-01-01T00:00:00Z'),
      });
      const ctx = createMockContext('user-123');

      await expect(
        mutation(
          {},
          { id: 'install-1', input: { installedAt: '2026-02-15T00:00:00Z' } },
          ctx as never
        )
      ).rejects.toThrow('Removal date cannot be before install date');
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('allows updating installedAt on a row with a non-conflicting existing removedAt', async () => {
      // Complement to the case above — if the new installedAt still sits
      // before the persisted removedAt, the update should proceed normally.
      mockFindUnique.mockResolvedValueOnce({
        id: 'install-1',
        userId: 'user-123',
        bikeId: 'bike-1',
        installedAt: new Date('2025-01-01T00:00:00Z'),
        removedAt: new Date('2026-03-01T00:00:00Z'),
      });
      const ctx = createMockContext('user-123');

      await mutation(
        {},
        { id: 'install-1', input: { installedAt: '2025-06-15T00:00:00Z' } },
        ctx as never
      );

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'install-1' },
        data: { installedAt: new Date('2025-06-15T00:00:00Z') },
      });
    });

    it('short-circuits empty input without touching Prisma or the cache', async () => {
      const existing = { id: 'install-1', userId: 'user-123', bikeId: 'bike-1' };
      mockFindUnique.mockResolvedValueOnce(existing);
      (invalidateBikePrediction as jest.Mock).mockClear();

      const ctx = createMockContext('user-123');
      const result = await mutation({}, { id: 'install-1', input: {} }, ctx as never);

      // Empty update is a no-op: no write, no cache invalidation, return the
      // existing row so clients still get a consistent response shape.
      expect(result).toBe(existing);
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(
        (invalidateBikePrediction as jest.Mock).mock.calls.filter((c) => c[1] === 'bike-1').length
      ).toBe(0);
    });
  });

  describe('Mutation.deleteBikeComponentInstall', () => {
    const mutation = resolvers.Mutation.deleteBikeComponentInstall;
    const mockFindUnique = mockPrisma.bikeComponentInstall.findUnique as jest.Mock;
    const mockDelete = mockPrisma.bikeComponentInstall.delete as jest.Mock;

    beforeEach(() => {
      mockFindUnique.mockReset();
      mockDelete.mockReset().mockResolvedValue({ id: 'install-1' });
    });

    it('rejects when the install is not owned by the viewer', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'install-1',
        userId: 'other-user',
        bikeId: 'bike-1',
      });
      const ctx = createMockContext('user-123');
      await expect(
        mutation({}, { id: 'install-1' }, ctx as never)
      ).rejects.toThrow('Install record not found');
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it('deletes the row and invalidates prediction cache', async () => {
      mockFindUnique.mockResolvedValueOnce({
        id: 'install-1',
        userId: 'user-123',
        bikeId: 'bike-9',
      });
      const ctx = createMockContext('user-123');

      const result = await mutation({}, { id: 'install-1' }, ctx as never);

      expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'install-1' } });
      expect(result).toBe(true);
      const calls = (invalidateBikePrediction as jest.Mock).mock.calls.filter(
        (c) => c[1] === 'bike-9'
      );
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Mutation.updateBikeAcquisition', () => {
    const mutation = resolvers.Mutation.updateBikeAcquisition;
    const mockBikeFindFirst = mockPrisma.bike.findFirst as jest.Mock;
    const mockBikeFindUnique = mockPrisma.bike.findUnique as jest.Mock;
    const mockBikeUpdate = mockPrisma.bike.update as jest.Mock;
    const mockInstallFindMany = mockPrisma.bikeComponentInstall.findMany as jest.Mock;
    const mockInstallUpdateMany = mockPrisma.bikeComponentInstall.updateMany as jest.Mock;
    const mockComponentUpdateMany = mockPrisma.component.updateMany as jest.Mock;
    const mockServiceLogUpdateMany = mockPrisma.serviceLog.updateMany as jest.Mock;
    const mockTransaction = mockPrisma.$transaction as jest.Mock;

    const setTransactionPassthrough = () => {
      mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
        return fn({
          bike: { update: mockBikeUpdate },
          bikeComponentInstall: {
            findMany: mockInstallFindMany,
            updateMany: mockInstallUpdateMany,
          },
          component: { updateMany: mockComponentUpdateMany },
          serviceLog: { updateMany: mockServiceLogUpdateMany },
        });
      });
    };

    beforeEach(() => {
      mockBikeFindFirst.mockReset();
      mockBikeFindUnique.mockReset();
      mockBikeUpdate.mockReset().mockResolvedValue({ id: 'bike-1' });
      mockInstallFindMany.mockReset().mockResolvedValue([]);
      mockInstallUpdateMany.mockReset().mockResolvedValue({ count: 0 });
      mockComponentUpdateMany.mockReset().mockResolvedValue({ count: 0 });
      mockServiceLogUpdateMany.mockReset().mockResolvedValue({ count: 0 });
      mockTransaction.mockReset();
      setTransactionPassthrough();
    });

    it('rejects when the bike is not owned by the viewer', async () => {
      mockBikeFindFirst.mockResolvedValueOnce(null);
      const ctx = createMockContext('user-123');

      await expect(
        mutation(
          {},
          { bikeId: 'bike-stolen', input: { acquisitionDate: '2023-01-01T00:00:00Z' } },
          ctx as never
        )
      ).rejects.toThrow('Bike not found');
      expect(mockBikeUpdate).not.toHaveBeenCalled();
    });

    it('rejects future acquisition dates', async () => {
      mockBikeFindFirst.mockResolvedValueOnce({
        id: 'bike-1',
        userId: 'user-123',
        createdAt: new Date('2026-04-01T00:00:00Z'),
      });
      const future = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();
      const ctx = createMockContext('user-123');

      await expect(
        mutation({}, { bikeId: 'bike-1', input: { acquisitionDate: future } }, ctx as never)
      ).rejects.toThrow('acquisitionDate cannot be in the future');
    });

    it('cascades to eligible installs and groups baseline service logs by old date', async () => {
      // Two components with the same buggy creation date (common migration
      // case) + one pre-existing install on a later date that must NOT be
      // moved by the cascade.
      mockBikeFindFirst.mockResolvedValueOnce({
        id: 'bike-1',
        userId: 'user-123',
        createdAt: new Date('2026-04-01T00:00:00Z'),
      });
      const oldDate = new Date('2026-04-01T00:00:05Z');
      mockInstallFindMany.mockResolvedValueOnce([
        { id: 'i1', componentId: 'c1', installedAt: oldDate },
        { id: 'i2', componentId: 'c2', installedAt: oldDate },
      ]);
      mockInstallUpdateMany.mockResolvedValueOnce({ count: 2 });
      mockComponentUpdateMany.mockResolvedValueOnce({ count: 2 });
      mockServiceLogUpdateMany.mockResolvedValueOnce({ count: 2 });
      mockBikeFindUnique.mockResolvedValueOnce({ id: 'bike-1', acquisitionDate: new Date('2024-05-10') });

      const ctx = createMockContext('user-123');
      const result = await mutation(
        {},
        { bikeId: 'bike-1', input: { acquisitionDate: '2024-05-10T00:00:00Z' } },
        ctx as never
      );

      expect(result.installsMoved).toBe(2);
      expect(result.serviceLogsMoved).toBe(2);

      // Single updateMany call because both installs share the same old
      // date — grouping collapsed them.
      expect(mockServiceLogUpdateMany).toHaveBeenCalledTimes(1);
      expect(mockServiceLogUpdateMany).toHaveBeenCalledWith({
        where: {
          componentId: { in: ['c1', 'c2'] },
          performedAt: oldDate,
          hoursAtService: 0,
        },
        data: { performedAt: new Date('2024-05-10T00:00:00Z') },
      });
    });

    it('skips the cascade when cascadeInstalls is false', async () => {
      mockBikeFindFirst.mockResolvedValueOnce({
        id: 'bike-1',
        userId: 'user-123',
        createdAt: new Date('2026-04-01T00:00:00Z'),
      });
      mockBikeFindUnique.mockResolvedValueOnce({ id: 'bike-1' });

      const ctx = createMockContext('user-123');
      const result = await mutation(
        {},
        {
          bikeId: 'bike-1',
          input: { acquisitionDate: '2024-05-10T00:00:00Z', cascadeInstalls: false },
        },
        ctx as never
      );

      expect(mockInstallFindMany).not.toHaveBeenCalled();
      expect(mockInstallUpdateMany).not.toHaveBeenCalled();
      expect(result.installsMoved).toBe(0);
      expect(result.serviceLogsMoved).toBe(0);
    });
  });

  describe('Mutation.bulkUpdateBikeComponentInstalls', () => {
    const mutation = resolvers.Mutation.bulkUpdateBikeComponentInstalls;
    const mockFindMany = mockPrisma.bikeComponentInstall.findMany as jest.Mock;
    const mockUpdateMany = mockPrisma.bikeComponentInstall.updateMany as jest.Mock;
    const mockServiceLogUpdateMany = mockPrisma.serviceLog.updateMany as jest.Mock;
    const mockTransaction = mockPrisma.$transaction as jest.Mock;

    beforeEach(() => {
      mockFindMany.mockReset();
      mockUpdateMany.mockReset().mockResolvedValue({ count: 0 });
      mockServiceLogUpdateMany.mockReset().mockResolvedValue({ count: 0 });
      // findMany is now called via the transaction client (race-closure
      // fix), so the tx mock needs to expose it alongside updateMany.
      mockTransaction.mockReset().mockImplementation(async (fn: (tx: unknown) => unknown) =>
        fn({
          bikeComponentInstall: { findMany: mockFindMany, updateMany: mockUpdateMany },
          serviceLog: { updateMany: mockServiceLogUpdateMany },
        })
      );
    });

    it('rejects the whole batch when any id is not owned by the viewer', async () => {
      // Two ids requested, one belongs to someone else — the batch is
      // all-or-nothing so the whole thing fails with NOT_FOUND.
      mockFindMany.mockResolvedValueOnce([
        { id: 'i1', userId: 'user-123', bikeId: 'bike-1', componentId: 'c1', installedAt: new Date(), removedAt: null },
        { id: 'i2', userId: 'other', bikeId: 'bike-1', componentId: 'c2', installedAt: new Date(), removedAt: null },
      ]);

      const ctx = createMockContext('user-123');
      await expect(
        mutation(
          {},
          { input: { ids: ['i1', 'i2'], installedAt: '2024-05-10T00:00:00Z' } },
          ctx as never
        )
      ).rejects.toThrow('Install record not found');
      expect(mockUpdateMany).not.toHaveBeenCalled();
    });

    it('rejects when an id does not exist (length mismatch)', async () => {
      mockFindMany.mockResolvedValueOnce([
        { id: 'i1', userId: 'user-123', bikeId: 'bike-1', componentId: 'c1', installedAt: new Date(), removedAt: null },
      ]);

      const ctx = createMockContext('user-123');
      await expect(
        mutation(
          {},
          { input: { ids: ['i1', 'i-missing'], installedAt: '2024-05-10T00:00:00Z' } },
          ctx as never
        )
      ).rejects.toThrow('Install record not found');
    });

    it('rejects when any row has a removedAt earlier than the target date', async () => {
      mockFindMany.mockResolvedValueOnce([
        {
          id: 'i1',
          userId: 'user-123',
          bikeId: 'bike-1',
          componentId: 'c1',
          installedAt: new Date('2020-01-01'),
          removedAt: new Date('2024-01-01'),
        },
      ]);

      const ctx = createMockContext('user-123');
      await expect(
        mutation(
          {},
          { input: { ids: ['i1'], installedAt: '2024-06-01T00:00:00Z' } },
          ctx as never
        )
      ).rejects.toThrow('Removal date cannot be before install date');
      expect(mockUpdateMany).not.toHaveBeenCalled();
    });

    it('rejects batches larger than the cap', async () => {
      const ids = Array.from({ length: 101 }, (_, i) => `i${i}`);
      const ctx = createMockContext('user-123');
      await expect(
        mutation(
          {},
          { input: { ids, installedAt: '2024-05-10T00:00:00Z' } },
          ctx as never
        )
      ).rejects.toThrow('Cannot update more than 100');
      expect(mockFindMany).not.toHaveBeenCalled();
    });

    it('deduplicates repeated ids before validation (no spurious NOT_FOUND)', async () => {
      // Client submits the same id twice. After dedup, findMany returns
      // one row and the length check passes — the mutation proceeds
      // rather than throwing NOT_FOUND on a length mismatch.
      mockFindMany.mockResolvedValueOnce([
        {
          id: 'i1',
          userId: 'user-123',
          bikeId: 'bike-1',
          componentId: 'c1',
          installedAt: new Date('2024-02-01T00:00:00Z'),
          removedAt: null,
        },
      ]);
      mockUpdateMany.mockResolvedValueOnce({ count: 1 });

      const ctx = createMockContext('user-123');
      const result = await mutation(
        {},
        { input: { ids: ['i1', 'i1'], installedAt: '2024-06-01T00:00:00Z' } },
        ctx as never
      );

      expect(result.updatedCount).toBe(1);
      // findMany queried with the deduped set, not the raw duplicates.
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { in: ['i1'] } }),
        })
      );
    });

    it('updates installs and moves baseline service logs grouped by old date', async () => {
      const oldDateA = new Date('2024-02-01T00:00:00Z');
      const oldDateB = new Date('2024-03-10T00:00:00Z');
      mockFindMany.mockResolvedValueOnce([
        { id: 'i1', userId: 'user-123', bikeId: 'bike-1', componentId: 'c1', installedAt: oldDateA, removedAt: null },
        { id: 'i2', userId: 'user-123', bikeId: 'bike-1', componentId: 'c2', installedAt: oldDateA, removedAt: null },
        { id: 'i3', userId: 'user-123', bikeId: 'bike-1', componentId: 'c3', installedAt: oldDateB, removedAt: null },
      ]);
      mockUpdateMany.mockResolvedValueOnce({ count: 3 });
      mockServiceLogUpdateMany
        .mockResolvedValueOnce({ count: 2 })
        .mockResolvedValueOnce({ count: 1 });

      const ctx = createMockContext('user-123');
      const result = await mutation(
        {},
        { input: { ids: ['i1', 'i2', 'i3'], installedAt: '2024-06-01T00:00:00Z' } },
        ctx as never
      );

      expect(result.updatedCount).toBe(3);
      expect(result.serviceLogsMoved).toBe(3);
      // Two groups → two serviceLog.updateMany calls.
      expect(mockServiceLogUpdateMany).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // selectBikeForDowngrade
  // =========================================================================
  describe('selectBikeForDowngrade', () => {
    const mutation = resolvers.Mutation.selectBikeForDowngrade;

    // Helper to create a mock transaction client for selectBikeForDowngrade
    const createDowngradeTx = (overrides: {
      needsDowngradeSelection?: boolean;
      bike?: unknown;
    } = {}) => {
      const mockBikeUpdateMany = jest.fn().mockResolvedValue({ count: 2 });
      const mockUserUpdate = jest.fn().mockResolvedValue({});
      const tx = {
        user: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            needsDowngradeSelection: overrides.needsDowngradeSelection ?? true,
          }),
          update: mockUserUpdate,
        },
        bike: {
          findFirst: jest.fn().mockResolvedValue(overrides.bike ?? null),
          updateMany: mockBikeUpdateMany,
        },
      };
      return { tx, mockBikeUpdateMany, mockUserUpdate };
    };

    it('should throw Unauthorized when user is not authenticated', async () => {
      const ctx = createMockContext(null);
      await expect(mutation({}, { bikeId: 'bike-1' }, ctx as never)).rejects.toThrow('Unauthorized');
    });

    it('should throw when needsDowngradeSelection is false', async () => {
      const ctx = createMockContext('user-123');
      const { tx } = createDowngradeTx({ needsDowngradeSelection: false });
      (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => unknown) => fn(tx));

      await expect(mutation({}, { bikeId: 'bike-1' }, ctx as never)).rejects.toThrow('No downgrade selection needed');
    });

    it('should throw when bike is not found', async () => {
      const ctx = createMockContext('user-123');
      const { tx } = createDowngradeTx({ bike: null });
      (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => unknown) => fn(tx));

      await expect(mutation({}, { bikeId: 'nonexistent' }, ctx as never)).rejects.toThrow('Bike not found');
    });

    it('should throw when bike belongs to another user', async () => {
      const ctx = createMockContext('user-123');
      const { tx } = createDowngradeTx({ bike: null });
      (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => unknown) => fn(tx));

      await expect(mutation({}, { bikeId: 'other-users-bike' }, ctx as never)).rejects.toThrow('Bike not found');
    });

    it('should archive other bikes and clear flag on valid selection', async () => {
      const ctx = createMockContext('user-123');
      const selectedBike = { id: 'bike-1', userId: 'user-123', status: 'ACTIVE' };
      const { tx, mockBikeUpdateMany, mockUserUpdate } = createDowngradeTx({ bike: selectedBike });
      (mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: unknown) => unknown) => fn(tx));

      const result = await mutation({}, { bikeId: 'bike-1' }, ctx as never);

      expect(result).toEqual(selectedBike);
      expect(mockBikeUpdateMany).toHaveBeenCalledWith({
        where: { userId: 'user-123', status: 'ACTIVE', id: { not: 'bike-1' } },
        data: { status: 'ARCHIVED' },
      });
      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: { needsDowngradeSelection: false },
      });
    });
  });

  describe('backfillWeatherForMyRides', () => {
    const mutation = resolvers.Mutation.backfillWeatherForMyRides;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { enqueueWeatherJob } = require('../../lib/queue/weather.queue') as {
      enqueueWeatherJob: jest.Mock;
    };
    const mockFindUniqueOrThrow = prisma.user.findUniqueOrThrow as jest.Mock;
    const mockRideFindMany = prisma.ride.findMany as jest.Mock;
    const mockRideCount = prisma.ride.count as jest.Mock;

    beforeEach(() => {
      enqueueWeatherJob.mockReset();
    });

    it('rejects free users with NOT_PRO', async () => {
      mockFindUniqueOrThrow.mockResolvedValueOnce({
        subscriptionTier: 'FREE_LIGHT',
        isFoundingRider: false,
        role: 'FREE',
      });
      const ctx = createMockContext('user-123');
      await expect(
        mutation({}, {}, ctx as never)
      ).rejects.toThrow('Weather backfill is a Pro feature.');
      expect(enqueueWeatherJob).not.toHaveBeenCalled();
    });

    it('rejects Pro calls that exceed the rate limit before touching the queue', async () => {
      // Pro check runs first so the Prisma lookup still happens; only the
      // queue work is short-circuited by the rate limit.
      mockFindUniqueOrThrow.mockResolvedValueOnce({
        subscriptionTier: 'PRO',
        isFoundingRider: false,
        role: 'FREE',
      });
      mockCheckMutationRateLimit.mockResolvedValueOnce({ allowed: false, retryAfter: 45 });
      const ctx = createMockContext('user-123');
      await expect(mutation({}, {}, ctx as never)).rejects.toThrow(
        'Rate limit exceeded. Try again in 45 seconds.'
      );
      expect(enqueueWeatherJob).not.toHaveBeenCalled();
    });

    it('does not consume a rate-limit token for free-user calls', async () => {
      mockFindUniqueOrThrow.mockResolvedValueOnce({
        subscriptionTier: 'FREE_LIGHT',
        isFoundingRider: false,
        role: 'FREE',
      });
      const ctx = createMockContext('user-123');
      await expect(mutation({}, {}, ctx as never)).rejects.toThrow(
        'Weather backfill is a Pro feature.'
      );
      expect(mockCheckMutationRateLimit).not.toHaveBeenCalled();
    });

    it('enqueues jobs for Pro users and returns counts', async () => {
      mockFindUniqueOrThrow.mockResolvedValueOnce({
        subscriptionTier: 'PRO',
        isFoundingRider: false,
        role: 'FREE',
      });
      mockRideFindMany.mockResolvedValueOnce([
        { id: 'ride-1' },
        { id: 'ride-2' },
        { id: 'ride-3' },
      ]);
      mockRideCount
        .mockResolvedValueOnce(3) // rides remaining (matches ridesWithCoords length)
        .mockResolvedValueOnce(4); // rides without coords
      enqueueWeatherJob
        .mockResolvedValueOnce({ status: 'queued', jobId: 'j1' })
        .mockResolvedValueOnce({ status: 'queued', jobId: 'j2' })
        .mockResolvedValueOnce({ status: 'already_queued', jobId: 'j3' });

      const ctx = createMockContext('user-123');
      const result = await mutation({}, {}, ctx as never);

      expect(result).toEqual({
        enqueuedCount: 2,
        ridesWithoutCoords: 4,
        remainingAfterBatch: 0,
      });
      expect(enqueueWeatherJob).toHaveBeenCalledTimes(3);
    });

    it('treats founding riders as Pro', async () => {
      mockFindUniqueOrThrow.mockResolvedValueOnce({
        subscriptionTier: 'FREE_LIGHT',
        isFoundingRider: true,
        role: 'FREE',
      });
      mockRideFindMany.mockResolvedValueOnce([]);
      mockRideCount.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

      const ctx = createMockContext('user-123');
      const result = await mutation({}, {}, ctx as never);

      expect(result).toEqual({
        enqueuedCount: 0,
        ridesWithoutCoords: 0,
        remainingAfterBatch: 0,
      });
    });

    it('does not let one enqueue failure abort the rest', async () => {
      mockFindUniqueOrThrow.mockResolvedValueOnce({
        subscriptionTier: 'PRO',
        isFoundingRider: false,
        role: 'FREE',
      });
      mockRideFindMany.mockResolvedValueOnce([
        { id: 'ride-1' },
        { id: 'ride-2' },
        { id: 'ride-3' },
      ]);
      mockRideCount.mockResolvedValueOnce(3).mockResolvedValueOnce(0);
      enqueueWeatherJob
        .mockResolvedValueOnce({ status: 'queued', jobId: 'j1' })
        .mockRejectedValueOnce(new Error('redis down'))
        .mockResolvedValueOnce({ status: 'queued', jobId: 'j3' });

      const ctx = createMockContext('user-123');
      const result = await mutation({}, {}, ctx as never);

      expect(result).toEqual({
        enqueuedCount: 2,
        ridesWithoutCoords: 0,
        remainingAfterBatch: 0,
      });
    });

    it('reports remainingAfterBatch when hitting the batch cap', async () => {
      mockFindUniqueOrThrow.mockResolvedValueOnce({
        subscriptionTier: 'PRO',
        isFoundingRider: false,
        role: 'FREE',
      });
      // Simulate the cap: findMany returns 500, count says 850 eligible total.
      const batch = Array.from({ length: 500 }, (_, i) => ({ id: `ride-${i}` }));
      mockRideFindMany.mockResolvedValueOnce(batch);
      mockRideCount.mockResolvedValueOnce(850).mockResolvedValueOnce(0);
      enqueueWeatherJob.mockResolvedValue({ status: 'queued', jobId: 'j' });

      const ctx = createMockContext('user-123');
      const result = await mutation({}, {}, ctx as never);

      expect(result.remainingAfterBatch).toBe(350);
      expect(result.enqueuedCount).toBe(500);
    });
  });

  describe('User.weatherBreakdown', () => {
    const resolver = resolvers.User.weatherBreakdown;
    const mockGroupBy = prisma.rideWeather.groupBy as jest.Mock;
    const mockRideCount = prisma.ride.count as jest.Mock;
    const mockBikeFindUnique = prisma.bike.findUnique as jest.Mock;

    beforeEach(() => {
      mockGroupBy.mockReset();
      mockRideCount.mockReset();
      mockBikeFindUnique.mockReset();
    });

    it('returns zero counts for a user with no rides', async () => {
      mockGroupBy.mockResolvedValueOnce([]);
      mockRideCount.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

      const result = await resolver({ id: 'user-123' }, {});

      expect(result).toEqual({
        sunny: 0,
        cloudy: 0,
        rainy: 0,
        snowy: 0,
        windy: 0,
        foggy: 0,
        unknown: 0,
        pending: 0,
        totalRides: 0,
      });
    });

    it('buckets grouped results and includes pending + total counts', async () => {
      mockGroupBy.mockResolvedValueOnce([
        { condition: 'SUNNY', _count: { _all: 12 } },
        { condition: 'RAINY', _count: { _all: 3 } },
        { condition: 'CLOUDY', _count: { _all: 7 } },
      ]);
      mockRideCount.mockResolvedValueOnce(5).mockResolvedValueOnce(27);

      const result = await resolver({ id: 'user-123' }, {});

      expect(result).toEqual({
        sunny: 12,
        cloudy: 7,
        rainy: 3,
        snowy: 0,
        windy: 0,
        foggy: 0,
        unknown: 0,
        pending: 5,
        totalRides: 27,
      });
    });

    it('applies date range filters to the underlying queries', async () => {
      mockGroupBy.mockResolvedValueOnce([]);
      mockRideCount.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

      await resolver({ id: 'user-123' }, {
        filter: { startDate: '2026-01-01T00:00:00Z', endDate: '2026-04-01T00:00:00Z' },
      });

      const groupByCall = mockGroupBy.mock.calls[0][0];
      expect(groupByCall.where.ride.userId).toBe('user-123');
      expect(groupByCall.where.ride.startTime.gte).toEqual(new Date('2026-01-01T00:00:00Z'));
      expect(groupByCall.where.ride.startTime.lte).toEqual(new Date('2026-04-01T00:00:00Z'));
    });

    it('verifies bike ownership before applying bikeId filter', async () => {
      mockBikeFindUnique.mockResolvedValueOnce({ userId: 'other-user' });

      await expect(
        resolver({ id: 'user-123' }, { filter: { bikeId: 'bike-stolen' } })
      ).rejects.toThrow('Bike not found');

      expect(mockGroupBy).not.toHaveBeenCalled();
    });

    it('applies bikeId filter when ownership checks out', async () => {
      mockBikeFindUnique.mockResolvedValueOnce({ userId: 'user-123' });
      mockGroupBy.mockResolvedValueOnce([]);
      mockRideCount.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

      await resolver({ id: 'user-123' }, { filter: { bikeId: 'bike-mine' } });

      const groupByCall = mockGroupBy.mock.calls[0][0];
      expect(groupByCall.where.ride.bikeId).toBe('bike-mine');
    });

    it('logs and skips an unknown condition value (schema drift safety)', async () => {
      // If a future migration adds a WeatherCondition enum value before the
      // resolver's local `breakdown` object is updated, the groupBy result
      // could contain a condition we don't have a bucket for. The resolver
      // should NOT throw and should NOT silently write to an undefined
      // slot — it should warn and skip.
      mockGroupBy.mockResolvedValueOnce([
        { condition: 'SUNNY', _count: { _all: 4 } },
        { condition: 'STORMY', _count: { _all: 99 } }, // hypothetical new enum
      ]);
      mockRideCount.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await resolver({ id: 'user-123' }, {});

      expect(result.sunny).toBe(4);
      // No new property leaks onto the returned object from the unknown key.
      expect(Object.keys(result).sort()).toEqual(
        [
          'cloudy',
          'foggy',
          'pending',
          'rainy',
          'snowy',
          'sunny',
          'totalRides',
          'unknown',
          'windy',
        ].sort()
      );
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('STORMY')
      );
      warn.mockRestore();
    });

    it('excludes rides without coords from the pending count', async () => {
      // "Pending" means fetchable-but-not-fetched, so WHOOP workouts (no
      // GPS) and pre-weather-integration imports must NOT be in the count.
      // Otherwise UI copy like "X rides still pending weather fetch" is a
      // lie for users with non-GPS sources.
      mockGroupBy.mockResolvedValueOnce([]);
      mockRideCount.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

      await resolver({ id: 'user-123' }, {});

      // First ride.count call is pending — must require non-null coords.
      const pendingWhere = mockRideCount.mock.calls[0][0].where;
      expect(pendingWhere.weather).toBeNull();
      expect(pendingWhere.startLat).toEqual({ not: null });
      expect(pendingWhere.startLng).toEqual({ not: null });

      // Second ride.count call is totalRides — should NOT have the coord
      // filter since it's a count of everything in the timeframe.
      const totalWhere = mockRideCount.mock.calls[1][0].where;
      expect(totalWhere.startLat).toBeUndefined();
      expect(totalWhere.startLng).toBeUndefined();
    });
  });

  describe('Query.bikeHistory', () => {
    const resolver = resolvers.Query.bikeHistory;
    const mockBikeFindFirst = mockPrisma.bike.findFirst as jest.Mock;
    const mockRideFindMany = mockPrisma.ride.findMany as jest.Mock;
    const mockServiceLogFindMany = mockPrisma.serviceLog.findMany as jest.Mock;
    const mockInstallFindMany = mockPrisma.bikeComponentInstall.findMany as jest.Mock;
    const mockUserFindUniqueOrThrow = mockPrisma.user.findUniqueOrThrow as jest.Mock;

    beforeEach(() => {
      mockBikeFindFirst.mockReset();
      mockRideFindMany.mockReset().mockResolvedValue([]);
      mockServiceLogFindMany.mockReset().mockResolvedValue([]);
      mockInstallFindMany.mockReset().mockResolvedValue([]);
      // Default to PRO so existing tests see every event type. Individual tests
      // can override for tier-gated assertions.
      mockUserFindUniqueOrThrow.mockReset().mockResolvedValue({
        subscriptionTier: 'PRO',
        isFoundingRider: false,
        role: 'FREE',
      });
    });

    it('rejects when the bike is not owned by the viewer', async () => {
      mockBikeFindFirst.mockResolvedValueOnce(null);
      const ctx = createMockContext('user-123');

      await expect(
        resolver({}, { bikeId: 'bike-stolen' }, ctx as never)
      ).rejects.toThrow('Bike not found');

      expect(mockRideFindMany).not.toHaveBeenCalled();
    });

    it('enforces the rate limit before any DB work', async () => {
      // Protects against a polling loop fanning out to three findMany
      // queries per hit. Rate-limit rejection must short-circuit before
      // the ownership check and before the data queries — so a rejected
      // caller can't even confirm whether the bike exists.
      mockCheckMutationRateLimit.mockResolvedValueOnce({ allowed: false, retryAfter: 42 });
      const ctx = createMockContext('user-123');

      await expect(
        resolver({}, { bikeId: 'bike-1' }, ctx as never)
      ).rejects.toThrow('Rate limit exceeded. Try again in 42 seconds.');

      expect(mockBikeFindFirst).not.toHaveBeenCalled();
      expect(mockRideFindMany).not.toHaveBeenCalled();
      expect(mockServiceLogFindMany).not.toHaveBeenCalled();
      expect(mockInstallFindMany).not.toHaveBeenCalled();
    });

    it('returns merged totals and events within the timeframe', async () => {
      mockBikeFindFirst.mockResolvedValueOnce({ id: 'bike-1', userId: 'user-123' });
      mockRideFindMany.mockResolvedValueOnce([
        { id: 'r1', distanceMeters: 10000, durationSeconds: 3600, elevationGainMeters: 300 },
        { id: 'r2', distanceMeters: 5000, durationSeconds: 1800, elevationGainMeters: 150 },
      ]);
      mockServiceLogFindMany.mockResolvedValueOnce([
        {
          id: 's1',
          performedAt: new Date('2026-01-15T00:00:00Z'),
          notes: 'fork lowers',
          hoursAtService: 120,
          component: { id: 'c1' },
        },
      ]);
      mockInstallFindMany.mockResolvedValueOnce([]);

      const ctx = createMockContext('user-123');
      const result = await resolver(
        {},
        { bikeId: 'bike-1', startDate: '2026-01-01T00:00:00Z', endDate: '2026-12-31T23:59:59Z' },
        ctx as never
      );

      expect(result.totals).toEqual({
        rideCount: 2,
        totalDistanceMeters: 15000,
        totalDurationSeconds: 5400,
        totalElevationGainMeters: 450,
        serviceEventCount: 1,
        installEventCount: 0,
      });
      expect(result.serviceEvents[0].performedAt).toBe('2026-01-15T00:00:00.000Z');
      expect(result.truncated).toBe(false);
    });

    it('splits a BikeComponentInstall with removedAt into two events', async () => {
      mockBikeFindFirst.mockResolvedValueOnce({ id: 'bike-1', userId: 'user-123' });
      mockInstallFindMany.mockResolvedValueOnce([
        {
          id: 'i1',
          installedAt: new Date('2026-01-10T00:00:00Z'),
          removedAt: new Date('2026-03-20T00:00:00Z'),
          component: { id: 'c1' },
        },
      ]);

      const ctx = createMockContext('user-123');
      const result = await resolver({}, { bikeId: 'bike-1' }, ctx as never);

      expect(result.installs).toHaveLength(2);
      expect(result.installs.map((i: { eventType: string }) => i.eventType).sort()).toEqual([
        'INSTALLED',
        'REMOVED',
      ]);
      expect(result.installs.find((i: { eventType: string }) => i.eventType === 'INSTALLED').occurredAt)
        .toBe('2026-01-10T00:00:00.000Z');
      expect(result.installs.find((i: { eventType: string }) => i.eventType === 'REMOVED').occurredAt)
        .toBe('2026-03-20T00:00:00.000Z');
    });

    it('drops install/remove events outside the requested timeframe', async () => {
      mockBikeFindFirst.mockResolvedValueOnce({ id: 'bike-1', userId: 'user-123' });
      // Install in 2025, removed in 2026 — with a 2026-only filter, only REMOVED should show.
      mockInstallFindMany.mockResolvedValueOnce([
        {
          id: 'i1',
          installedAt: new Date('2025-06-01T00:00:00Z'),
          removedAt: new Date('2026-02-01T00:00:00Z'),
          component: { id: 'c1' },
        },
      ]);

      const ctx = createMockContext('user-123');
      const result = await resolver(
        {},
        { bikeId: 'bike-1', startDate: '2026-01-01T00:00:00Z', endDate: '2026-12-31T23:59:59Z' },
        ctx as never
      );

      expect(result.installs).toHaveLength(1);
      expect(result.installs[0].eventType).toBe('REMOVED');
    });

    it('restricts service & install events to unlocked component types on Free Light', async () => {
      mockBikeFindFirst.mockResolvedValueOnce({ id: 'bike-1', userId: 'user-123' });
      mockUserFindUniqueOrThrow.mockReset().mockResolvedValue({
        subscriptionTier: 'FREE_LIGHT',
        isFoundingRider: false,
        role: 'FREE',
      });

      const ctx = createMockContext('user-123');
      await resolver({}, { bikeId: 'bike-1' }, ctx as never);

      // Service query's component filter must restrict to unlocked types.
      const serviceWhere = mockServiceLogFindMany.mock.calls[0][0].where;
      expect(serviceWhere.component.bikeId).toBe('bike-1');
      expect(serviceWhere.component.type.in).toEqual(
        expect.arrayContaining(['FORK', 'SHOCK', 'BRAKE_PAD', 'PIVOT_BEARINGS'])
      );

      // Install query must scope the same filter onto its joined component.
      const installWhere = mockInstallFindMany.mock.calls[0][0].where;
      expect(installWhere.component.type.in).toEqual(
        expect.arrayContaining(['FORK', 'SHOCK', 'BRAKE_PAD', 'PIVOT_BEARINGS'])
      );
    });

    it('does not apply a component type filter for Pro users', async () => {
      mockBikeFindFirst.mockResolvedValueOnce({ id: 'bike-1', userId: 'user-123' });
      // Default PRO mock from beforeEach applies.

      const ctx = createMockContext('user-123');
      await resolver({}, { bikeId: 'bike-1' }, ctx as never);

      // Pro tier: no `type` restriction on the joined Component, but the
      // defense-in-depth userId filter still applies everywhere.
      const serviceWhere = mockServiceLogFindMany.mock.calls[0][0].where;
      expect(serviceWhere.component).toEqual({ bikeId: 'bike-1', userId: 'user-123' });
      const installWhere = mockInstallFindMany.mock.calls[0][0].where;
      expect(installWhere.component).toBeUndefined();
      expect(installWhere.userId).toBe('user-123');
    });

    it('applies a defense-in-depth userId filter on every sub-query', async () => {
      // Ownership check above is the primary guard, but every inner query
      // redundantly restricts by userId so a future refactor can't silently
      // leak cross-user data.
      mockBikeFindFirst.mockResolvedValueOnce({ id: 'bike-1', userId: 'user-123' });

      const ctx = createMockContext('user-123');
      await resolver({}, { bikeId: 'bike-1' }, ctx as never);

      const rideWhere = mockRideFindMany.mock.calls[0][0].where;
      expect(rideWhere.userId).toBe('user-123');

      const serviceWhere = mockServiceLogFindMany.mock.calls[0][0].where;
      expect(serviceWhere.component.userId).toBe('user-123');

      const installWhere = mockInstallFindMany.mock.calls[0][0].where;
      expect(installWhere.userId).toBe('user-123');
    });

    it('marks truncated=true when the ride cap is hit', async () => {
      mockBikeFindFirst.mockResolvedValueOnce({ id: 'bike-1', userId: 'user-123' });
      const lotsOfRides = Array.from({ length: 2000 }, (_, i) => ({
        id: `r${i}`,
        distanceMeters: 1000,
        durationSeconds: 600,
        elevationGainMeters: 50,
      }));
      mockRideFindMany.mockResolvedValueOnce(lotsOfRides);

      const ctx = createMockContext('user-123');
      const result = await resolver({}, { bikeId: 'bike-1' }, ctx as never);

      expect(result.truncated).toBe(true);
    });
  });
});
