const mockUserFindUnique = jest.fn();
const mockUserCreate = jest.fn();
const mockReferralCreate = jest.fn();
const mockTransaction = jest.fn();
const mockResolveReferrer = jest.fn();
const mockGenerateReferralCode = jest.fn().mockReturnValue('abc12345');
const mockSetSessionCookie = jest.fn();
const mockSetCsrfCookie = jest.fn().mockReturnValue('csrf-token');
const mockValidatePassword = jest.fn().mockReturnValue({ isValid: true });
const mockHashPassword = jest.fn().mockResolvedValue('hashed');

jest.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: mockUserFindUnique,
      create: mockUserCreate,
    },
    referral: {
      create: mockReferralCreate,
    },
    $transaction: mockTransaction,
  },
}));

jest.mock('../lib/rate-limit', () => ({
  checkAuthRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
}));

jest.mock('../lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../services/referral.service', () => ({
  generateReferralCode: () => mockGenerateReferralCode(),
  resolveReferrer: (...args: unknown[]) => mockResolveReferrer(...args),
  createUserWithReferralCode: async (fn: (code: string) => Promise<unknown>) => fn('abc12345'),
}));

jest.mock('../auth/password.utils', () => ({
  validatePassword: (...args: unknown[]) => mockValidatePassword(...args),
  hashPassword: (...args: unknown[]) => mockHashPassword(...args),
}));

jest.mock('../auth/session', () => ({
  setSessionCookie: (...args: unknown[]) => mockSetSessionCookie(...args),
}));

jest.mock('../auth/csrf', () => ({
  setCsrfCookie: (...args: unknown[]) => mockSetCsrfCookie(...args),
}));

jest.mock('../auth/email.utils', () => ({
  validateEmailFormat: jest.fn().mockReturnValue(true),
}));

jest.mock('../auth/utils', () => ({
  normalizeEmail: jest.fn((e: string) => e.toLowerCase()),
}));

// Must mock config BEFORE importing the router
const mockConfig = { bypassWaitlistFlow: false };
jest.mock('../config/env', () => ({
  config: mockConfig,
}));

import express from 'express';
import request from 'supertest';
import waitlistRouter from './waitlist';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', waitlistRouter);
  return app;
}

describe('POST /api/waitlist', () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    app = createApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.bypassWaitlistFlow = false;
    mockUserFindUnique.mockResolvedValue(null); // no existing user
  });

  describe('waitlist mode (bypass OFF)', () => {
    it('should create a WAITLIST user without password', async () => {
      mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
        const tx = {
          user: { create: jest.fn().mockResolvedValue({ id: 'user-1', email: 'test@test.com' }) },
          referral: { create: jest.fn() },
        };
        return fn(tx);
      });

      const res = await request(app)
        .post('/api/waitlist')
        .send({ email: 'test@test.com', name: 'Test' });

      expect(res.status).toBe(201);
    });

    it('should create referral row when valid ref code provided', async () => {
      mockResolveReferrer.mockResolvedValue('referrer-id');

      let referralCreated = false;
      mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
        const tx = {
          user: { create: jest.fn().mockResolvedValue({ id: 'user-1', email: 'test@test.com' }) },
          referral: { create: jest.fn().mockImplementation(() => { referralCreated = true; return Promise.resolve({}); }) },
        };
        return fn(tx);
      });

      const res = await request(app)
        .post('/api/waitlist')
        .send({ email: 'test@test.com', name: 'Test', ref: 'validcode' });

      expect(res.status).toBe(201);
      expect(mockResolveReferrer).toHaveBeenCalledWith('validcode');
      expect(referralCreated).toBe(true);
    });

    it('should create user without referral when ref code is invalid', async () => {
      mockResolveReferrer.mockResolvedValue(null);

      let referralCreated = false;
      mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
        const tx = {
          user: { create: jest.fn().mockResolvedValue({ id: 'user-1', email: 'test@test.com' }) },
          referral: { create: jest.fn().mockImplementation(() => { referralCreated = true; return Promise.resolve({}); }) },
        };
        return fn(tx);
      });

      const res = await request(app)
        .post('/api/waitlist')
        .send({ email: 'test@test.com', name: 'Test', ref: 'badcode' });

      expect(res.status).toBe(201);
      expect(referralCreated).toBe(false);
    });
  });

  describe('bypass mode (bypass ON)', () => {
    beforeEach(() => {
      mockConfig.bypassWaitlistFlow = true;
    });

    it('should require password when bypass is on', async () => {
      const res = await request(app)
        .post('/api/waitlist')
        .send({ email: 'test@test.com', name: 'Test' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/[Pp]assword/);
    });

    it('should create FREE user with auto-login when bypass is on', async () => {
      let createdRole: string | undefined;
      mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
        const tx = {
          user: {
            create: jest.fn().mockImplementation(({ data }: { data: { role: string } }) => {
              createdRole = data.role;
              return Promise.resolve({ id: 'user-1', email: 'test@test.com' });
            }),
          },
          referral: { create: jest.fn() },
        };
        return fn(tx);
      });

      const res = await request(app)
        .post('/api/waitlist')
        .send({ email: 'test@test.com', name: 'Test', password: 'ValidPass1!' });

      expect(res.status).toBe(201);
      expect(res.body.waitlist).toBe(false);
      expect(res.body.csrfToken).toBe('csrf-token');
      expect(createdRole).toBe('FREE');
      expect(mockSetSessionCookie).toHaveBeenCalled();
    });

    it('should create referral row atomically with user when ref is valid', async () => {
      mockResolveReferrer.mockResolvedValue('referrer-id');

      let referralData: { referrerUserId?: string; referredUserId?: string } | undefined;
      mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
        const tx = {
          user: { create: jest.fn().mockResolvedValue({ id: 'new-user', email: 'test@test.com' }) },
          referral: {
            create: jest.fn().mockImplementation(({ data }: { data: typeof referralData }) => {
              referralData = data;
              return Promise.resolve({});
            }),
          },
        };
        return fn(tx);
      });

      await request(app)
        .post('/api/waitlist')
        .send({ email: 'test@test.com', name: 'Test', password: 'ValidPass1!', ref: 'goodcode' });

      expect(referralData).toEqual({ referrerUserId: 'referrer-id', referredUserId: 'new-user' });
    });

    it('should reject invalid password', async () => {
      mockValidatePassword.mockReturnValue({ isValid: false, error: 'Too weak' });

      const res = await request(app)
        .post('/api/waitlist')
        .send({ email: 'test@test.com', name: 'Test', password: 'bad' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Too weak');

      mockValidatePassword.mockReturnValue({ isValid: true });
    });
  });
});

describe('GET /api/config', () => {
  it('should return waitlistEnabled: true when bypass is off', async () => {
    mockConfig.bypassWaitlistFlow = false;
    const app = createApp();

    const res = await request(app).get('/api/config');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ waitlistEnabled: true });
  });

  it('should return waitlistEnabled: false when bypass is on', async () => {
    mockConfig.bypassWaitlistFlow = true;
    const app = createApp();

    const res = await request(app).get('/api/config');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ waitlistEnabled: false });
  });
});
