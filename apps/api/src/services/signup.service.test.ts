jest.mock('../lib/prisma', () => ({
  prisma: {
    user: { findFirst: jest.fn(), create: jest.fn() },
  },
}));

jest.mock('../lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

import { prisma } from '../lib/prisma';
import { createNewUser, verifyEmailAvailable, type VerifiedUniqueEmail } from './signup.service';

const mockFindFirst = prisma.user.findFirst as unknown as jest.Mock;
const mockCreate = prisma.user.create as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('verifyEmailAvailable', () => {
  it('checks the exact address and its folded inbox', async () => {
    mockFindFirst.mockResolvedValue(null);

    await expect(verifyEmailAvailable('john.smith+2@gmail.com')).resolves.toEqual({
      available: true,
      email: 'john.smith+2@gmail.com',
    });
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { OR: [{ email: 'john.smith+2@gmail.com' }, { emailCanonical: 'johnsmith@gmail.com' }] },
      select: { id: true },
    });
  });

  it('reports another spelling of an existing inbox as taken', async () => {
    mockFindFirst.mockResolvedValue({ id: 'existing' });

    await expect(verifyEmailAvailable('johnsmith@googlemail.com')).resolves.toEqual({ available: false });
  });
});

describe('createNewUser', () => {
  it('stores the address as typed, its folded form, the forensics, and requires verification', async () => {
    mockCreate.mockResolvedValue({ id: 'u1', email: 'John.Smith+2@gmail.com', name: 'John' });

    const result = await createNewUser({
      email: 'John.Smith+2@gmail.com' as VerifiedUniqueEmail,
      name: 'John',
      passwordHash: 'hash',
      signupIp: '203.0.113.9',
      signupUserAgent: 'okhttp/4.12.0',
    });

    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        email: 'John.Smith+2@gmail.com',
        emailCanonical: 'johnsmith@gmail.com',
        emailVerificationRequired: true,
        name: 'John',
        role: 'FREE',
        subscriptionTier: 'FREE',
        passwordHash: 'hash',
        signupIp: '203.0.113.9',
        signupUserAgent: 'okhttp/4.12.0',
      },
    });
    expect(result).toEqual({ user: { id: 'u1', email: 'John.Smith+2@gmail.com', name: 'John' } });
  });
});
