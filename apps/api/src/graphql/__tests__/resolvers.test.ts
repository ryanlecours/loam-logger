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
      update: jest.fn(),
    },
    ride: {
      findMany: jest.fn(),
    },
    serviceLog: {
      create: jest.fn(),
    },
    termsAcceptance: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    user: {
      update: jest.fn(),
    },
    bikeServicePreference: {
      findMany: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    bikeComponentInstall: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
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
          data: { hoursUsed: 0 },
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
});
