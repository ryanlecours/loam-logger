import type { Request, Response, NextFunction, RequestHandler } from 'express';

// Mock Prisma
const mockTransaction = jest.fn();
const mockUserUpdate = jest.fn();
const mockBikeCreate = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    $transaction: mockTransaction,
    user: {
      update: mockUserUpdate,
    },
    bike: {
      create: mockBikeCreate,
    },
  },
}));

// Mock buildBikeComponents
const mockBuildBikeComponents = jest.fn();
jest.mock('../graphql/resolvers', () => ({
  buildBikeComponents: mockBuildBikeComponents,
  // Re-export types that are used
}));

// Mock logger
jest.mock('../lib/logger', () => ({
  logError: jest.fn(),
}));

// Import router after mocks
import router from './onboarding';

// Type for Express router layer internals
interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RequestHandler }>;
  };
}

// Helper to get route handler - need to find POST /complete handler
function getHandler(): RequestHandler | undefined {
  const routerStack = (router as unknown as { stack: RouteLayer[] }).stack;
  const layer = routerStack.find(
    (l) => l.route?.path === '/complete' && l.route?.methods?.post
  );
  // Route has express.json() middleware first, then actual handler
  const handlers = layer?.route?.stack;
  // The actual handler is after the json middleware
  return handlers?.[handlers.length - 1]?.handle;
}

// Helper to invoke handler with proper signature
async function invokeHandler(
  h: RequestHandler | undefined,
  req: Request,
  res: Response
): Promise<void> {
  if (!h) throw new Error('Handler not found');
  await h(req, res, jest.fn() as NextFunction);
}

describe('POST /onboarding/complete', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let handler: RequestHandler | undefined;
  let jsonResponse: unknown;

  beforeEach(() => {
    jest.clearAllMocks();
    handler = getHandler();
    jsonResponse = undefined;

    mockReq = {
      sessionUser: { uid: 'user-123' },
      body: {
        bikeMake: 'Santa Cruz',
        bikeModel: 'Bronson',
        bikeYear: 2024,
        bikeTravelFork: 160,
        bikeTravelShock: 150,
      },
    };

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockImplementation((data) => {
        jsonResponse = data;
        return mockRes;
      }),
    };

    // Setup default successful transaction behavior
    mockTransaction.mockImplementation(async (fn) => {
      const tx = {
        user: { update: mockUserUpdate },
        bike: { create: mockBikeCreate },
      };
      return fn(tx);
    });

    mockUserUpdate.mockResolvedValue({ id: 'user-123' });
    mockBikeCreate.mockResolvedValue({ id: 'bike-456' });
    mockBuildBikeComponents.mockResolvedValue(undefined);
  });

  describe('Authentication', () => {
    it('should return 401 when user is not authenticated', async () => {
      mockReq.sessionUser = undefined;

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(jsonResponse).toMatchObject({
        error: 'No active session',
        code: 'UNAUTHORIZED',
      });
    });

    it('should return 401 when sessionUser.uid is missing', async () => {
      mockReq.sessionUser = {} as { uid: string };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(401);
    });
  });

  describe('Validation', () => {
    it('should return 400 when bikeMake is missing', async () => {
      mockReq.body = { bikeModel: 'Bronson' };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(jsonResponse).toMatchObject({
        error: 'Bike make and model are required',
        code: 'BAD_REQUEST',
      });
    });

    it('should return 400 when bikeModel is missing', async () => {
      mockReq.body = { bikeMake: 'Santa Cruz' };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(jsonResponse).toMatchObject({
        error: 'Bike make and model are required',
        code: 'BAD_REQUEST',
      });
    });

    it('should return 400 when age is below minimum (16)', async () => {
      mockReq.body = {
        bikeMake: 'Santa Cruz',
        bikeModel: 'Bronson',
        age: 15,
      };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(jsonResponse).toMatchObject({
        error: 'Please enter a valid age',
        code: 'BAD_REQUEST',
      });
    });

    it('should return 400 when age is above maximum (150)', async () => {
      mockReq.body = {
        bikeMake: 'Santa Cruz',
        bikeModel: 'Bronson',
        age: 151,
      };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(jsonResponse).toMatchObject({
        error: 'Please enter a valid age',
        code: 'BAD_REQUEST',
      });
    });

    it('should accept valid age at boundary (16)', async () => {
      mockReq.body = {
        bikeMake: 'Santa Cruz',
        bikeModel: 'Bronson',
        age: 16,
      };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    it('should accept valid age at boundary (150)', async () => {
      mockReq.body = {
        bikeMake: 'Santa Cruz',
        bikeModel: 'Bronson',
        age: 150,
      };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
    });
  });

  describe('User Update', () => {
    it('should update user with onboarding data', async () => {
      mockReq.body = {
        bikeMake: 'Santa Cruz',
        bikeModel: 'Bronson',
        age: 30,
        location: 'California',
      };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: {
          age: 30,
          location: 'California',
          onboardingCompleted: true,
        },
      });
    });

    it('should set age and location to null when not provided', async () => {
      mockReq.body = {
        bikeMake: 'Santa Cruz',
        bikeModel: 'Bronson',
      };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        data: {
          age: null,
          location: null,
          onboardingCompleted: true,
        },
      });
    });
  });

  describe('Bike Creation', () => {
    it('should create bike with basic fields', async () => {
      mockReq.body = {
        bikeMake: 'Santa Cruz',
        bikeModel: 'Bronson',
        bikeYear: 2024,
        bikeTravelFork: 160,
        bikeTravelShock: 150,
      };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockBikeCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-123',
          manufacturer: 'Santa Cruz',
          model: 'Bronson',
          year: 2024,
          travelForkMm: 160,
          travelShockMm: 150,
        }),
      });
    });

    it('should create bike with 99spokes metadata', async () => {
      mockReq.body = {
        bikeMake: 'Santa Cruz',
        bikeModel: 'Bronson',
        spokesId: 'spokes-123',
        spokesUrl: 'https://99spokes.com/bike',
        thumbnailUrl: 'https://example.com/thumb.jpg',
        family: 'MTB',
        category: 'Trail',
        subcategory: 'All-Mountain',
        buildKind: 'Complete',
        isFrameset: false,
        gender: 'Unisex',
        frameMaterial: 'Carbon',
        hangerStandard: 'SRAM UDH',
      };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockBikeCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          spokesId: 'spokes-123',
          spokesUrl: 'https://99spokes.com/bike',
          thumbnailUrl: 'https://example.com/thumb.jpg',
          family: 'MTB',
          category: 'Trail',
          subcategory: 'All-Mountain',
          buildKind: 'Complete',
          isFrameset: false,
          gender: 'Unisex',
          frameMaterial: 'Carbon',
          hangerStandard: 'SRAM UDH',
        }),
      });
    });

    it('should create e-bike with motor/battery specs', async () => {
      mockReq.body = {
        bikeMake: 'Specialized',
        bikeModel: 'Levo',
        isEbike: true,
        motorMaker: 'Specialized',
        motorModel: '2.2',
        motorPowerW: 250,
        motorTorqueNm: 90,
        batteryWh: 700,
      };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockBikeCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          isEbike: true,
          motorMaker: 'Specialized',
          motorModel: '2.2',
          motorPowerW: 250,
          motorTorqueNm: 90,
          batteryWh: 700,
        }),
      });
    });

    it('should NOT store e-bike specs when isEbike is false', async () => {
      mockReq.body = {
        bikeMake: 'Santa Cruz',
        bikeModel: 'Bronson',
        isEbike: false,
        motorMaker: 'Bosch', // Should be ignored
        motorPowerW: 250, // Should be ignored
      };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockBikeCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          isEbike: false,
          motorMaker: null,
          motorModel: null,
          motorPowerW: null,
          motorTorqueNm: null,
          batteryWh: null,
        }),
      });
    });
  });

  describe('Component Creation via buildBikeComponents', () => {
    it('should call buildBikeComponents with correct BikeSpec for full suspension', async () => {
      mockReq.body = {
        bikeMake: 'Santa Cruz',
        bikeModel: 'Bronson',
        bikeTravelFork: 160,
        bikeTravelShock: 150,
      };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockBuildBikeComponents).toHaveBeenCalledWith(
        expect.anything(), // transaction client
        expect.objectContaining({
          bikeId: 'bike-456',
          userId: 'user-123',
          bikeSpec: {
            hasFrontSuspension: true,
            hasRearSuspension: true,
            brakeType: 'disc',
            drivetrainType: '1x',
          },
        })
      );
    });

    it('should call buildBikeComponents with correct BikeSpec for hardtail', async () => {
      mockReq.body = {
        bikeMake: 'Santa Cruz',
        bikeModel: 'Chameleon',
        bikeTravelFork: 130,
        bikeTravelShock: 0, // Hardtail
      };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockBuildBikeComponents).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          bikeSpec: {
            hasFrontSuspension: true,
            hasRearSuspension: false,
            brakeType: 'disc',
            drivetrainType: '1x',
          },
        })
      );
    });

    it('should call buildBikeComponents with correct BikeSpec for rigid bike', async () => {
      mockReq.body = {
        bikeMake: 'Surly',
        bikeModel: 'Karate Monkey',
        bikeTravelFork: 0,
        bikeTravelShock: 0,
      };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockBuildBikeComponents).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          bikeSpec: {
            hasFrontSuspension: false,
            hasRearSuspension: false,
            brakeType: 'disc',
            drivetrainType: '1x',
          },
        })
      );
    });

    it('should pass acquisitionCondition to buildBikeComponents', async () => {
      mockReq.body = {
        bikeMake: 'Santa Cruz',
        bikeModel: 'Bronson',
        acquisitionCondition: 'USED',
      };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockBuildBikeComponents).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          acquisitionCondition: 'USED',
        })
      );
    });

    it('should default acquisitionCondition to NEW when not provided', async () => {
      mockReq.body = {
        bikeMake: 'Santa Cruz',
        bikeModel: 'Bronson',
      };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockBuildBikeComponents).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          acquisitionCondition: 'NEW',
        })
      );
    });

    it('should pass spokesComponents to buildBikeComponents', async () => {
      const spokesComponents = {
        fork: { make: 'Fox', model: '36' },
        rearShock: { make: 'Fox', model: 'DPX2' },
      };

      mockReq.body = {
        bikeMake: 'Santa Cruz',
        bikeModel: 'Bronson',
        spokesComponents,
      };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockBuildBikeComponents).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          spokesComponents,
        })
      );
    });

    it('should pass user component overrides to buildBikeComponents', async () => {
      const components = {
        fork: { brand: 'Fox', model: '38 Factory' },
        shock: { brand: 'Fox', model: 'Float X2' },
        wheels: { brand: 'Reserve', model: '30|HD' },
      };

      mockReq.body = {
        bikeMake: 'Santa Cruz',
        bikeModel: 'Bronson',
        components,
      };

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockBuildBikeComponents).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          userOverrides: components,
        })
      );
    });
  });

  describe('Success Response', () => {
    it('should return 200 with bike ID on success', async () => {
      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(jsonResponse).toEqual({
        ok: true,
        message: 'Onboarding completed successfully',
        bikeId: 'bike-456',
      });
    });
  });

  describe('Transaction Atomicity', () => {
    it('should use transaction for all database operations', async () => {
      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockTransaction).toHaveBeenCalled();
      // Verify user update and bike create were called within transaction
      expect(mockUserUpdate).toHaveBeenCalled();
      expect(mockBikeCreate).toHaveBeenCalled();
      expect(mockBuildBikeComponents).toHaveBeenCalled();
    });

    it('should rollback on user update failure', async () => {
      mockUserUpdate.mockRejectedValue(new Error('User update failed'));

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockBikeCreate).not.toHaveBeenCalled();
    });

    it('should rollback on bike create failure', async () => {
      mockBikeCreate.mockRejectedValue(new Error('Bike create failed'));

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });

    it('should rollback on buildBikeComponents failure', async () => {
      mockBuildBikeComponents.mockRejectedValue(new Error('Component creation failed'));

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });
  });

  describe('Error Handling', () => {
    it('should return 500 on unexpected error', async () => {
      mockTransaction.mockRejectedValue(new Error('Database connection lost'));

      await invokeHandler(handler, mockReq as Request, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(jsonResponse).toMatchObject({
        error: 'An error occurred while completing onboarding. Please try again.',
        code: 'INTERNAL_ERROR',
      });
    });
  });
});
