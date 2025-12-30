// Mock dependencies before imports
jest.mock('../lib/queue/connection', () => ({
  getQueueConnection: jest.fn(() => ({
    connection: { host: 'localhost', port: 6379 },
  })),
}));

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../lib/prisma', () => ({
  prisma: {
    ride: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

jest.mock('../lib/location', () => ({
  reverseGeocode: jest.fn(),
}));

import { createGeocodeWorker, closeGeocodeWorker } from './geocode.worker';
import { Worker } from 'bullmq';
import { prisma } from '../lib/prisma';
import { reverseGeocode } from '../lib/location';

const MockedWorker = Worker as jest.MockedClass<typeof Worker>;
const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockReverseGeocode = reverseGeocode as jest.MockedFunction<typeof reverseGeocode>;

describe('createGeocodeWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await closeGeocodeWorker();
  });

  it('should create a worker with correct queue name', () => {
    createGeocodeWorker();

    expect(MockedWorker).toHaveBeenCalledWith(
      'geocode',
      expect.any(Function),
      expect.objectContaining({ concurrency: 1 })
    );
  });

  it('should return the same worker on subsequent calls', () => {
    const worker1 = createGeocodeWorker();
    const worker2 = createGeocodeWorker();

    expect(worker1).toBe(worker2);
    expect(MockedWorker).toHaveBeenCalledTimes(1);
  });

  it('should set up event handlers', () => {
    const mockOn = jest.fn();
    MockedWorker.mockImplementation(() => ({
      on: mockOn,
      close: jest.fn().mockResolvedValue(undefined),
    }) as never);

    createGeocodeWorker();

    expect(mockOn).toHaveBeenCalledWith('completed', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('failed', expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
  });
});

describe('closeGeocodeWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should close the worker if it exists', async () => {
    const mockClose = jest.fn().mockResolvedValue(undefined);
    MockedWorker.mockImplementation(() => ({
      on: jest.fn(),
      close: mockClose,
    }) as never);

    createGeocodeWorker();
    await closeGeocodeWorker();

    expect(mockClose).toHaveBeenCalled();
  });

  it('should be safe to call multiple times', async () => {
    await closeGeocodeWorker();
    await closeGeocodeWorker();
    // No error thrown
  });
});

describe('processGeocodeJob (via worker processor)', () => {
  let processGeocodeJob: (job: { data: { rideId: string; lat: number; lon: number } }) => Promise<void>;

  beforeEach(() => {
    jest.clearAllMocks();

    MockedWorker.mockImplementation((queueName, processor) => {
      processGeocodeJob = processor as typeof processGeocodeJob;
      return {
        on: jest.fn(),
        close: jest.fn().mockResolvedValue(undefined),
      } as never;
    });

    createGeocodeWorker();
  });

  afterEach(async () => {
    await closeGeocodeWorker();
  });

  describe('validation', () => {
    it('should throw when rideId is missing', async () => {
      await expect(
        processGeocodeJob({
          data: { rideId: '', lat: 39.7392, lon: -104.9903 },
        })
      ).rejects.toThrow('Invalid job data: rideId is required');
    });

    it('should throw when lat is not a number', async () => {
      await expect(
        processGeocodeJob({
          data: { rideId: 'ride123', lat: NaN, lon: -104.9903 },
        })
      ).rejects.toThrow('Invalid job data: lat and lon must be valid numbers');
    });

    it('should throw when lon is not a number', async () => {
      await expect(
        processGeocodeJob({
          data: { rideId: 'ride123', lat: 39.7392, lon: NaN },
        })
      ).rejects.toThrow('Invalid job data: lat and lon must be valid numbers');
    });
  });

  describe('geocoding', () => {
    it('should call reverseGeocode with coordinates', async () => {
      mockReverseGeocode.mockResolvedValue('Denver, Colorado, USA');
      (mockPrisma.ride.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      await processGeocodeJob({
        data: { rideId: 'ride123', lat: 39.7392, lon: -104.9903 },
      });

      expect(mockReverseGeocode).toHaveBeenCalledWith(39.7392, -104.9903);
    });

    it('should update ride location when geocoding succeeds', async () => {
      mockReverseGeocode.mockResolvedValue('Boulder, Colorado, USA');
      (mockPrisma.ride.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      await processGeocodeJob({
        data: { rideId: 'ride123', lat: 40.015, lon: -105.2705 },
      });

      expect(mockPrisma.ride.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'ride123',
          location: { startsWith: 'Lat ' },
        },
        data: { location: 'Boulder, Colorado, USA' },
      });
    });

    it('should not update when geocoding returns null', async () => {
      mockReverseGeocode.mockResolvedValue(null);

      await processGeocodeJob({
        data: { rideId: 'ride123', lat: 0, lon: 0 },
      });

      expect(mockPrisma.ride.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('ride not found or location protection', () => {
    it('should handle case when ride does not exist (updateMany returns count 0)', async () => {
      mockReverseGeocode.mockResolvedValue('Denver, Colorado, USA');
      (mockPrisma.ride.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      await processGeocodeJob({
        data: { rideId: 'deleted-ride', lat: 39.7392, lon: -104.9903 },
      });

      // updateMany is still called, but count will be 0
      expect(mockPrisma.ride.updateMany).toHaveBeenCalled();
    });

    it('should not overwrite user-edited location (updateMany condition handles this)', async () => {
      // When location doesn't start with "Lat ", updateMany will match 0 rows
      mockReverseGeocode.mockResolvedValue('Denver, Colorado, USA');
      (mockPrisma.ride.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      await processGeocodeJob({
        data: { rideId: 'ride123', lat: 39.7392, lon: -104.9903 },
      });

      // updateMany is called but will not update due to where clause
      expect(mockPrisma.ride.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'ride123',
          location: { startsWith: 'Lat ' },
        },
        data: { location: 'Denver, Colorado, USA' },
      });
    });

    it('should update location in lat/lon format', async () => {
      mockReverseGeocode.mockResolvedValue('Denver, Colorado, USA');
      (mockPrisma.ride.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      await processGeocodeJob({
        data: { rideId: 'ride123', lat: 39.7392, lon: -104.9903 },
      });

      expect(mockPrisma.ride.updateMany).toHaveBeenCalled();
    });

    it('should handle when location is null (updateMany condition handles this)', async () => {
      // When location is null, updateMany condition won't match
      mockReverseGeocode.mockResolvedValue('Denver, Colorado, USA');
      (mockPrisma.ride.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      await processGeocodeJob({
        data: { rideId: 'ride123', lat: 39.7392, lon: -104.9903 },
      });

      // updateMany is called but will not update due to where clause
      expect(mockPrisma.ride.updateMany).toHaveBeenCalled();
    });
  });
});
