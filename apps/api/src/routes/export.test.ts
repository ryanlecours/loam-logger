jest.mock('../lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
  },
}));

const mockCheckAuthRateLimit = jest.fn();
jest.mock('../lib/rate-limit', () => ({
  checkAuthRateLimit: (...args: unknown[]) => mockCheckAuthRateLimit(...args),
}));

const mockBuildMaintenanceCsv = jest.fn();
jest.mock('../lib/maintenance-export', () => ({
  buildMaintenanceCsv: (...args: unknown[]) => mockBuildMaintenanceCsv(...args),
}));

const mockCapture = jest.fn();
jest.mock('../lib/posthog', () => ({
  captureServerEvent: (...args: unknown[]) => mockCapture(...args),
}));

jest.mock('../lib/logger', () => ({
  logError: jest.fn(),
  logger: { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import express, { type Express } from 'express';
import request from 'supertest';
import exportRouter from './export';
import { prisma } from '../lib/prisma';

const mockFindUser = prisma.user.findUnique as jest.Mock;

function app(userId: string | null): Express {
  const a = express();
  a.use((req, _res, next) => {
    if (userId) req.sessionUser = { uid: userId, email: 'rider@example.com' } as never;
    next();
  });
  a.use('/api', exportRouter);
  return a;
}

describe('GET /api/export/maintenance.csv', () => {
  beforeEach(() => {
    mockCheckAuthRateLimit.mockResolvedValue({ allowed: true });
    mockFindUser.mockResolvedValue({ subscriptionTier: 'FREE', isFoundingRider: false, role: 'FREE' });
    mockBuildMaintenanceCsv.mockResolvedValue({ csv: '﻿date,bike\r\n', rowCount: 3, bikeCount: 1, attributed: false });
  });

  it('rejects anonymous requests', async () => {
    const res = await request(app(null)).get('/api/export/maintenance.csv');
    expect(res.status).toBe(401);
    expect(mockBuildMaintenanceCsv).not.toHaveBeenCalled();
  });

  it('serves the signed-in rider their CSV as an attachment and records the export', async () => {
    const res = await request(app('u1')).get('/api/export/maintenance.csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="loam-logger-maintenance-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toBe('﻿date,bike\r\n');
    expect(mockBuildMaintenanceCsv).toHaveBeenCalledWith(prisma, 'u1');
    expect(mockCapture).toHaveBeenCalledWith('u1', 'maintenance_exported', {
      format: 'csv',
      row_count: 3,
      bike_count: 1,
      tier: 'FREE',
    });
  });

  it('is free for every tier but rate limited per rider', async () => {
    mockCheckAuthRateLimit.mockResolvedValue({ allowed: false, retryAfter: 1200 });
    const res = await request(app('u1')).get('/api/export/maintenance.csv');
    expect(res.status).toBe(429);
    expect(mockCheckAuthRateLimit).toHaveBeenCalledWith('maintenance-export', 'u1');
    expect(mockBuildMaintenanceCsv).not.toHaveBeenCalled();
  });
});
