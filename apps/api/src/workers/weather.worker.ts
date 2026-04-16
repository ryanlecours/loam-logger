import '../instrument';
import { Worker, Job } from 'bullmq';
import * as Sentry from '@sentry/node';
import { getQueueConnection } from '../lib/queue/connection';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import type { WeatherJobData, WeatherJobName } from '../lib/queue';
import { getWeatherForRide } from '../lib/weather';

export async function processWeatherJob(
  job: Job<WeatherJobData, void, WeatherJobName>
): Promise<void> {
  const { rideId } = job.data;

  const ride = await prisma.ride.findUnique({
    where: { id: rideId },
    select: {
      id: true,
      startTime: true,
      durationSeconds: true,
      startLat: true,
      startLng: true,
      weather: { select: { id: true } },
    },
  });

  if (!ride) {
    logger.debug({ rideId }, '[WeatherWorker] Ride not found, skipping');
    return;
  }
  if (ride.weather) {
    logger.debug({ rideId }, '[WeatherWorker] Ride already has weather, skipping');
    return;
  }
  if (ride.startLat == null || ride.startLng == null) {
    logger.debug({ rideId }, '[WeatherWorker] Ride missing coords, skipping');
    return;
  }

  const summary = await getWeatherForRide({
    lat: ride.startLat,
    lng: ride.startLng,
    startTime: ride.startTime,
    durationSeconds: ride.durationSeconds,
  });

  if (!summary) {
    logger.warn({ rideId }, '[WeatherWorker] No weather samples returned');
    return;
  }

  const rawJson = { samples: summary.samples };

  await prisma.rideWeather.upsert({
    where: { rideId },
    create: {
      rideId,
      tempC: summary.tempC,
      feelsLikeC: summary.feelsLikeC,
      precipitationMm: summary.precipitationMm,
      windSpeedKph: summary.windSpeedKph,
      humidity: summary.humidity,
      wmoCode: summary.wmoCode,
      condition: summary.condition,
      lat: ride.startLat,
      lng: ride.startLng,
      source: summary.source,
      rawJson,
    },
    update: {
      tempC: summary.tempC,
      feelsLikeC: summary.feelsLikeC,
      precipitationMm: summary.precipitationMm,
      windSpeedKph: summary.windSpeedKph,
      humidity: summary.humidity,
      wmoCode: summary.wmoCode,
      condition: summary.condition,
      source: summary.source,
      fetchedAt: new Date(),
      rawJson,
    },
  });
}

let weatherWorker: Worker<WeatherJobData, void, WeatherJobName> | null = null;

export function createWeatherWorker(): Worker<WeatherJobData, void, WeatherJobName> {
  if (weatherWorker) return weatherWorker;

  weatherWorker = new Worker<WeatherJobData, void, WeatherJobName>(
    'weather',
    processWeatherJob,
    {
      connection: getQueueConnection(),
      concurrency: 3,
      drainDelay: 5000,
    }
  );

  weatherWorker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, '[WeatherWorker] Completed');
  });
  weatherWorker.on('failed', (job, err) => {
    logger.warn({ jobId: job?.id, error: err.message }, '[WeatherWorker] Job failed');
    Sentry.captureException(err, { tags: { worker: 'weather' }, extra: { jobId: job?.id } });
  });
  weatherWorker.on('error', (err) => {
    logger.error({ error: err.message }, '[WeatherWorker] Worker error');
    Sentry.captureException(err, { tags: { worker: 'weather' } });
  });

  return weatherWorker;
}

export async function closeWeatherWorker(): Promise<void> {
  if (weatherWorker) {
    await weatherWorker.close();
    weatherWorker = null;
  }
}
