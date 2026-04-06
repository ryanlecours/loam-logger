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
}));

const mockCreateNewUser = jest.fn();
const mockVerifyEmailAvailable = jest.fn();
jest.mock('../services/signup.service', () => ({
  createNewUser: (...args: unknown[]) => mockCreateNewUser(...args),
  verifyEmailAvailable: (...args: unknown[]) => mockVerifyEmailAvailable(...args),
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
  getClientIp: jest.fn(() => '127.0.0.1'),
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
    mockVerifyEmailAvailable.mockResolvedValue({ available: true, email: 'test@test.com' });
  });

  describe('waitlist mode (bypass OFF)', () => {
    it('should create a WAITLIST user without password', async () => {
      mockCreateNewUser.mockResolvedValue({ user: { id: 'user-1', email: 'test@test.com' }, waitlist: true });

      const res = await request(app)
        .post('/api/waitlist')
        .send({ email: 'test@test.com', name: 'Test' });

      expect(res.status).toBe(201);
      expect(mockCreateNewUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'test@test.com',
          name: 'Test',
          passwordHash: null,
          ref: undefined,
        })
      );
    });

    it('should pass ref to createNewUser when provided', async () => {
      mockCreateNewUser.mockResolvedValue({ user: { id: 'user-1', email: 'test@test.com' }, waitlist: true });

      const res = await request(app)
        .post('/api/waitlist')
        .send({ email: 'test@test.com', name: 'Test', ref: 'validcode' });

      expect(res.status).toBe(201);
      expect(mockCreateNewUser).toHaveBeenCalledWith(
        expect.objectContaining({ ref: 'validcode' })
      );
    });

    it('should pass null ref when ref code is not provided', async () => {
      mockCreateNewUser.mockResolvedValue({ user: { id: 'user-1', email: 'test@test.com' }, waitlist: true });

      const res = await request(app)
        .post('/api/waitlist')
        .send({ email: 'test@test.com', name: 'Test' });

      expect(res.status).toBe(201);
      expect(mockCreateNewUser).toHaveBeenCalledWith(
        expect.objectContaining({ ref: undefined })
      );
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
      mockCreateNewUser.mockResolvedValue({ user: { id: 'user-1', email: 'test@test.com' }, waitlist: false });

      const res = await request(app)
        .post('/api/waitlist')
        .send({ email: 'test@test.com', name: 'Test', password: 'ValidPass1!' });

      expect(res.status).toBe(201);
      expect(res.body.waitlist).toBe(false);
      expect(res.body.csrfToken).toBe('csrf-token');
      expect(mockSetSessionCookie).toHaveBeenCalled();
      expect(mockCreateNewUser).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'test@test.com', passwordHash: 'hashed' })
      );
    });

    it('should pass ref to createNewUser for referral tracking', async () => {
      mockCreateNewUser.mockResolvedValue({ user: { id: 'new-user', email: 'test@test.com' }, waitlist: false });

      await request(app)
        .post('/api/waitlist')
        .send({ email: 'test@test.com', name: 'Test', password: 'ValidPass1!', ref: 'goodcode' });

      expect(mockCreateNewUser).toHaveBeenCalledWith(
        expect.objectContaining({ ref: 'goodcode' })
      );
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
