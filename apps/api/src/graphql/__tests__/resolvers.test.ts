// Mock dependencies before imports
jest.mock('../../lib/prisma', () => ({
  prisma: {
    component: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
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
    $transaction: jest.fn(),
  },
}));

jest.mock('../../lib/rate-limit', () => ({
  checkMutationRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
}));

jest.mock('../../services/prediction/cache', () => ({
  invalidateBikePrediction: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../lib/queue', () => ({
  enqueueBikeInvalidation: jest.fn(),
}));

import { resolvers } from '../resolvers';
import { prisma } from '../../lib/prisma';
import { checkMutationRateLimit } from '../../lib/rate-limit';
import { invalidateBikePrediction } from '../../services/prediction/cache';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockCheckMutationRateLimit = checkMutationRateLimit as jest.MockedFunction<typeof checkMutationRateLimit>;

// Helper to create mock GraphQL context
const createMockContext = (userId: string | null = 'user-123') => ({
  user: userId ? { id: userId } : null,
  loaders: {
    serviceLogsByComponentId: { load: jest.fn() },
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
});
