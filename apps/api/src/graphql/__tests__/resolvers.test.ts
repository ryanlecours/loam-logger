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
      update: jest.fn(),
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
});
