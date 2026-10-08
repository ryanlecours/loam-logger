const mockCleanupResetTokens = jest.fn();
const mockCleanupVerificationTokens = jest.fn();

jest.mock('./password-reset.service', () => ({
  cleanupExpiredPasswordResetTokens: (...args: unknown[]) => mockCleanupResetTokens(...args),
}));
jest.mock('./email-verification.service', () => ({
  cleanupExpiredEmailVerificationTokens: (...args: unknown[]) => mockCleanupVerificationTokens(...args),
}));
jest.mock('../lib/logger', () => {
  const log = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
  return { createLogger: () => log };
});

import { startPasswordResetCleanup, stopPasswordResetCleanup } from './password-reset-cleanup.service';

const flush = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => {
  stopPasswordResetCleanup();
  jest.clearAllMocks();
});

describe('auth token cleanup job', () => {
  it('prunes password reset and email verification tokens on start', async () => {
    mockCleanupResetTokens.mockResolvedValue(0);
    mockCleanupVerificationTokens.mockResolvedValue(2);

    startPasswordResetCleanup();
    await flush();

    expect(mockCleanupResetTokens).toHaveBeenCalledWith(7 * 24);
    expect(mockCleanupVerificationTokens).toHaveBeenCalledWith(7 * 24);
  });

  it('still prunes verification tokens when the reset cleanup fails', async () => {
    mockCleanupResetTokens.mockRejectedValue(new Error('db down'));
    mockCleanupVerificationTokens.mockResolvedValue(0);

    startPasswordResetCleanup();
    await flush();

    expect(mockCleanupVerificationTokens).toHaveBeenCalled();
  });
});
