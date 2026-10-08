process.env.SESSION_SECRET = 'test-secret';

const mockCheckLoginRateLimit = jest.fn();
const mockVerifyPassword = jest.fn();
const mockUserFindUnique = jest.fn();
const mockUserUpdate = jest.fn();
const mockAccountFindUnique = jest.fn();
const mockAccountCreate = jest.fn();

jest.mock('./login-rate-limit', () => ({
  checkLoginRateLimit: (...args: unknown[]) => mockCheckLoginRateLimit(...args),
  LOGIN_RATE_LIMIT_MESSAGE: 'Too many login attempts. Please try again later.',
}));
jest.mock('./password.utils', () => ({
  verifyPassword: (...args: unknown[]) => mockVerifyPassword(...args),
}));
jest.mock('../lib/prisma', () => {
  const tx = {
    userAccount: {
      findUnique: (...args: unknown[]) => mockAccountFindUnique(...args),
      create: (...args: unknown[]) => mockAccountCreate(...args),
    },
    user: { update: (...args: unknown[]) => mockUserUpdate(...args) },
  };
  return {
    prisma: {
      user: { findUnique: (...args: unknown[]) => mockUserFindUnique(...args) },
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});
jest.mock('../lib/logger', () => {
  const log = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
  return { createLogger: () => log, logger: log };
});

import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import {
  completeProviderLink,
  createProviderLinkToken,
  sendLinkNeedsPassword,
  verifyProviderLinkToken,
  type ProviderLinkClaims,
} from './provider-link';
import { verifyToken } from './token';
import { ProviderLinkNeedsPasswordError, LINK_NEEDS_PASSWORD_MESSAGE } from './account-linking';

const claims: ProviderLinkClaims = {
  provider: 'google',
  sub: 'google-123',
  userId: 'legacy',
  email: 'rider@example.com',
  name: 'Alex Rider',
  picture: 'https://example.com/a.png',
};

const legacyUser = {
  id: 'legacy',
  email: 'rider@example.com',
  name: null,
  avatarUrl: null,
  passwordHash: 'hash',
  emailVerified: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCheckLoginRateLimit.mockResolvedValue({ allowed: true });
  mockVerifyPassword.mockResolvedValue(true);
  mockUserFindUnique.mockResolvedValue(legacyUser);
  mockAccountFindUnique.mockResolvedValue(null);
  mockAccountCreate.mockResolvedValue({});
  mockUserUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'legacy',
    email: 'rider@example.com',
    name: data.name ?? null,
    avatarUrl: data.avatarUrl ?? null,
  }));
});

describe('link tokens', () => {
  it('round-trips the provider identity', () => {
    expect(verifyProviderLinkToken(createProviderLinkToken(claims))).toEqual(claims);
  });

  // A link token must never pass as a session or mobile credential, and a
  // session-signed token must never pass as a link token.
  it('is not interchangeable with session-signed tokens', () => {
    const linkToken = createProviderLinkToken(claims);
    expect(verifyToken(linkToken)).toBeNull();

    const sessionSigned = jwt.sign(claims, 'test-secret');
    expect(verifyProviderLinkToken(sessionSigned)).toBeNull();
  });

  it('rejects an expired token', () => {
    const expired = jwt.sign({ ...claims, exp: Math.floor(Date.now() / 1000) - 10 }, 'test-secret:provider-link');
    expect(verifyProviderLinkToken(expired)).toBeNull();
  });
});

describe('sendLinkNeedsPassword', () => {
  it('answers 409 with the code, message and a usable link token', () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };

    sendLinkNeedsPassword(
      res as never,
      new ProviderLinkNeedsPasswordError('google', 'legacy', 'rider@example.com'),
      { sub: 'google-123', name: 'Alex Rider', picture: null }
    );

    expect(res.status).toHaveBeenCalledWith(409);
    const body = res.json.mock.calls[0][0];
    expect(body).toMatchObject({
      error: LINK_NEEDS_PASSWORD_MESSAGE,
      code: 'LINK_NEEDS_PASSWORD',
      details: { email: 'rider@example.com', provider: 'google' },
    });
    expect(verifyProviderLinkToken(body.details.linkToken)).toMatchObject({
      provider: 'google',
      sub: 'google-123',
      userId: 'legacy',
    });
  });
});

describe('completeProviderLink', () => {
  const token = () => createProviderLinkToken(claims);

  it('refuses a bad or missing token before anything else', async () => {
    await expect(completeProviderLink('nonsense', 'pw', '1.2.3.4')).resolves.toMatchObject({
      ok: false,
      status: 400,
      code: 'LINK_EXPIRED',
    });
    await expect(completeProviderLink(undefined, 'pw', '1.2.3.4')).resolves.toMatchObject({ code: 'LINK_EXPIRED' });
    expect(mockCheckLoginRateLimit).not.toHaveBeenCalled();
  });

  it('applies the password login limits, per IP and per account', async () => {
    mockCheckLoginRateLimit.mockResolvedValue({ allowed: false, retryAfter: 60 });

    const result = await completeProviderLink(token(), 'pw', '1.2.3.4');

    expect(mockCheckLoginRateLimit).toHaveBeenCalledWith('1.2.3.4', 'rider@example.com');
    expect(result).toMatchObject({ ok: false, status: 429, retryAfter: 60 });
    expect(mockVerifyPassword).not.toHaveBeenCalled();
  });

  it('refuses a wrong password without linking', async () => {
    mockVerifyPassword.mockResolvedValue(false);

    const result = await completeProviderLink(token(), 'wrong', '1.2.3.4');

    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(mockAccountCreate).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('voids the token when the account email changed since it was issued', async () => {
    mockUserFindUnique.mockResolvedValue({ ...legacyUser, email: 'new@example.com' });

    await expect(completeProviderLink(token(), 'pw', '1.2.3.4')).resolves.toMatchObject({ code: 'LINK_EXPIRED' });
    expect(mockVerifyPassword).not.toHaveBeenCalled();
  });

  it('links, verifies the email and fills a missing name and photo', async () => {
    const result = await completeProviderLink(token(), 'right', '1.2.3.4');

    expect(mockVerifyPassword).toHaveBeenCalledWith('right', 'hash');
    expect(mockAccountCreate).toHaveBeenCalledWith({
      data: { userId: 'legacy', provider: 'google', providerUserId: 'google-123' },
    });
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'legacy' },
        data: {
          emailVerified: expect.any(Date),
          name: 'Alex Rider',
          avatarUrl: 'https://example.com/a.png',
        },
      })
    );
    expect(result).toEqual({
      ok: true,
      user: { id: 'legacy', email: 'rider@example.com', name: 'Alex Rider', avatarUrl: 'https://example.com/a.png' },
    });
  });

  it('keeps the name and photo the rider already has', async () => {
    mockUserFindUnique.mockResolvedValue({ ...legacyUser, name: 'Kept', avatarUrl: 'kept.png' });

    await completeProviderLink(token(), 'right', '1.2.3.4');

    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Kept', avatarUrl: 'kept.png' }) })
    );
  });

  it('refuses when the provider identity belongs to another account', async () => {
    mockAccountFindUnique.mockResolvedValue({ userId: 'someone-else' });

    const result = await completeProviderLink(token(), 'right', '1.2.3.4');

    expect(result).toMatchObject({ ok: false, status: 409, code: 'PROVIDER_ALREADY_LINKED' });
    expect(mockAccountCreate).not.toHaveBeenCalled();
  });

  it('treats losing a race to the same link as success', async () => {
    mockAccountCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' })
    );

    await expect(completeProviderLink(token(), 'right', '1.2.3.4')).resolves.toMatchObject({ ok: true });
  });
});
