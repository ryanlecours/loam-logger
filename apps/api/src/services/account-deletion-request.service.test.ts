jest.mock('../lib/prisma', () => ({
  prisma: { user: { findUnique: jest.fn() } },
}));

jest.mock('./email.service', () => ({
  sendEmail: jest.fn().mockResolvedValue('msg_1'),
}));

jest.mock('./account-deletion.service', () => ({
  deleteUserAccount: jest.fn().mockResolvedValue({ email: 'rider@example.com' }),
}));

jest.mock('../lib/account-deletion-token', () => ({
  ACCOUNT_DELETION_TTL_MINUTES: 60,
  generateAccountDeletionToken: jest.fn().mockReturnValue('signed-token'),
  verifyAccountDeletionToken: jest.fn(),
}));

jest.mock('@react-email/render', () => ({
  render: jest.fn().mockResolvedValue('<html>email</html>'),
}));

jest.mock('../lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

jest.mock('../config/env', () => ({ FRONTEND_URL: 'https://loamlogger.app' }));

import { prisma } from '../lib/prisma';
import { sendEmail } from './email.service';
import { deleteUserAccount } from './account-deletion.service';
import { generateAccountDeletionToken, verifyAccountDeletionToken } from '../lib/account-deletion-token';
import {
  buildAccountDeletionConfirmUrl,
  confirmAccountDeletion,
  sendAccountDeletionEmail,
} from './account-deletion-request.service';

const mockFindUnique = prisma.user.findUnique as unknown as jest.Mock;
const mockVerify = verifyAccountDeletionToken as jest.Mock;
const mockDelete = deleteUserAccount as jest.Mock;
const mockSendEmail = sendEmail as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('buildAccountDeletionConfirmUrl', () => {
  it('points at the web confirm page, not an API endpoint that deletes on GET', () => {
    expect(buildAccountDeletionConfirmUrl('abc')).toBe('https://loamlogger.app/delete-account/confirm?token=abc');
  });
});

describe('sendAccountDeletionEmail', () => {
  it('signs a token for the user and emails it to their address', async () => {
    await sendAccountDeletionEmail({ id: 'user_1', email: 'rider@example.com', name: 'Alex Rider', sessionTokenVersion: 2 });

    expect(generateAccountDeletionToken).toHaveBeenCalledWith('user_1', 'rider@example.com', 2);
    expect(mockSendEmail).toHaveBeenCalledWith({
      to: 'rider@example.com',
      subject: 'Confirm your Loam Logger account deletion',
      html: '<html>email</html>',
    });
  });
});

describe('confirmAccountDeletion', () => {
  it('passes through an expired or invalid token without deleting', async () => {
    mockVerify.mockReturnValue({ ok: false, reason: 'expired' });
    await expect(confirmAccountDeletion('t')).resolves.toEqual({ ok: false, reason: 'expired' });

    mockVerify.mockReturnValue({ ok: false, reason: 'invalid' });
    await expect(confirmAccountDeletion('t')).resolves.toEqual({ ok: false, reason: 'invalid' });

    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('rejects a token for an account that no longer exists', async () => {
    mockVerify.mockReturnValue({ ok: true, userId: 'user_1', email: 'rider@example.com', sessionTokenVersion: 0 });
    mockFindUnique.mockResolvedValue(null);

    await expect(confirmAccountDeletion('t')).resolves.toEqual({ ok: false, reason: 'invalid' });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('rejects a token sent before the account email changed', async () => {
    mockVerify.mockReturnValue({ ok: true, userId: 'user_1', email: 'old@example.com', sessionTokenVersion: 0 });
    mockFindUnique.mockResolvedValue({ id: 'user_1', email: 'new@example.com', sessionTokenVersion: 0 });

    await expect(confirmAccountDeletion('t')).resolves.toEqual({ ok: false, reason: 'invalid' });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('rejects a token sent before a password reset or change', async () => {
    mockVerify.mockReturnValue({ ok: true, userId: 'user_1', email: 'rider@example.com', sessionTokenVersion: 0 });
    mockFindUnique.mockResolvedValue({ id: 'user_1', email: 'rider@example.com', sessionTokenVersion: 1 });

    await expect(confirmAccountDeletion('t')).resolves.toEqual({ ok: false, reason: 'invalid' });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('compares emails normalized, so a case difference in a stored row still matches', async () => {
    mockVerify.mockReturnValue({ ok: true, userId: 'user_1', email: 'rider@example.com', sessionTokenVersion: 0 });
    mockFindUnique.mockResolvedValue({ id: 'user_1', email: 'Rider@Example.com', sessionTokenVersion: 0 });

    await expect(confirmAccountDeletion('t')).resolves.toEqual({ ok: true, userId: 'user_1' });
  });

  it('deletes the account through the shared deletion service', async () => {
    mockVerify.mockReturnValue({ ok: true, userId: 'user_1', email: 'rider@example.com', sessionTokenVersion: 0 });
    mockFindUnique.mockResolvedValue({ id: 'user_1', email: 'rider@example.com', sessionTokenVersion: 0 });

    await expect(confirmAccountDeletion('t')).resolves.toEqual({ ok: true, userId: 'user_1' });
    expect(mockDelete).toHaveBeenCalledWith('user_1');
  });

  it('lets deletion errors propagate to the route', async () => {
    mockVerify.mockReturnValue({ ok: true, userId: 'user_1', email: 'rider@example.com', sessionTokenVersion: 0 });
    mockFindUnique.mockResolvedValue({ id: 'user_1', email: 'rider@example.com', sessionTokenVersion: 0 });
    mockDelete.mockRejectedValueOnce(new Error('stripe down'));

    await expect(confirmAccountDeletion('t')).rejects.toThrow('stripe down');
  });
});
