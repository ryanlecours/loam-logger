// Stop side-effectful imports (Sentry init, BullMQ Redis connection) from
// firing just because the worker module is loaded.
jest.mock('../instrument', () => ({}));
jest.mock('bullmq', () => ({ Worker: jest.fn() }));
jest.mock('../lib/queue/connection', () => ({ getQueueConnection: jest.fn() }));
jest.mock('@sentry/node', () => ({ captureException: jest.fn() }));

jest.mock('../lib/prisma', () => ({
  prisma: {
    ride: { findUnique: jest.fn() },
    rideWeather: { upsert: jest.fn() },
  },
}));

jest.mock('../lib/weather', () => ({
  getWeatherForRide: jest.fn(),
}));

import { processWeatherJob } from './weather.worker';
import { prisma } from '../lib/prisma';
import { getWeatherForRide } from '../lib/weather';

const mockFindUnique = prisma.ride.findUnique as jest.Mock;
const mockUpsert = prisma.rideWeather.upsert as jest.Mock;
const mockGetWeather = getWeatherForRide as jest.Mock;

const makeJob = (rideId = 'ride-1') =>
  ({ data: { rideId }, id: 'job-1' } as never);

describe('processWeatherJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('skips when the ride does not exist', async () => {
    mockFindUnique.mockResolvedValueOnce(null);

    await processWeatherJob(makeJob());

    expect(mockGetWeather).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('skips when the ride already has weather', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'ride-1',
      startTime: new Date('2026-04-15T10:00:00Z'),
      durationSeconds: 3600,
      startLat: 45.1,
      startLng: -122.3,
      weather: { id: 'existing-weather' },
    });

    await processWeatherJob(makeJob());

    expect(mockGetWeather).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('skips when the ride is missing coordinates', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'ride-1',
      startTime: new Date('2026-04-15T10:00:00Z'),
      durationSeconds: 3600,
      startLat: null,
      startLng: null,
      weather: null,
    });

    await processWeatherJob(makeJob());

    expect(mockGetWeather).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('skips upsert when the weather lib returns null (no samples)', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'ride-1',
      startTime: new Date('2026-04-15T10:00:00Z'),
      durationSeconds: 3600,
      startLat: 45.1,
      startLng: -122.3,
      weather: null,
    });
    mockGetWeather.mockResolvedValueOnce(null);

    await processWeatherJob(makeJob());

    expect(mockGetWeather).toHaveBeenCalledTimes(1);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('upserts the RideWeather row on success and stores samples in rawJson', async () => {
    const startTime = new Date('2026-04-15T10:00:00Z');
    mockFindUnique.mockResolvedValueOnce({
      id: 'ride-1',
      startTime,
      durationSeconds: 3600,
      startLat: 45.1,
      startLng: -122.3,
      weather: null,
    });
    const summary = {
      tempC: 18,
      feelsLikeC: 17,
      precipitationMm: 0.2,
      windSpeedKph: 8,
      humidity: 62,
      wmoCode: 3,
      condition: 'CLOUDY',
      source: 'open-meteo',
      samples: [{ timeUtc: '2026-04-15T10:00', tempC: 18, wmoCode: 3 }],
    };
    mockGetWeather.mockResolvedValueOnce(summary);

    await processWeatherJob(makeJob());

    expect(mockGetWeather).toHaveBeenCalledWith({
      lat: 45.1,
      lng: -122.3,
      startTime,
      durationSeconds: 3600,
    });
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const call = mockUpsert.mock.calls[0][0];
    expect(call.where).toEqual({ rideId: 'ride-1' });
    expect(call.create).toMatchObject({
      rideId: 'ride-1',
      tempC: 18,
      condition: 'CLOUDY',
      lat: 45.1,
      lng: -122.3,
      source: 'open-meteo',
      rawJson: { samples: summary.samples },
    });
    expect(call.update).toMatchObject({
      tempC: 18,
      condition: 'CLOUDY',
      rawJson: { samples: summary.samples },
    });
  });

  it('propagates weather-lib errors so BullMQ can retry the job', async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: 'ride-1',
      startTime: new Date('2026-04-15T10:00:00Z'),
      durationSeconds: 3600,
      startLat: 45.1,
      startLng: -122.3,
      weather: null,
    });
    mockGetWeather.mockRejectedValueOnce(new Error('Open-Meteo timeout'));

    await expect(processWeatherJob(makeJob())).rejects.toThrow('Open-Meteo timeout');
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
