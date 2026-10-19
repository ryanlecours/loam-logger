const mockUserFindUnique = jest.fn();
const mockUserUpdate = jest.fn().mockResolvedValue({});
const mockBikeCount = jest.fn().mockResolvedValue(1);

const mockTx = {
  user: { findUnique: mockUserFindUnique, update: mockUserUpdate },
  bike: { count: mockBikeCount },
};

jest.mock('../lib/prisma', () => ({
  prisma: {
    $transaction: (cb: (tx: unknown) => unknown) => cb(mockTx),
  },
}));

jest.mock('../lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockSendEmailWithAudit = jest.fn().mockResolvedValue(undefined);
jest.mock('./email.service', () => ({
  sendEmailWithAudit: (...args: unknown[]) => mockSendEmailWithAudit(...args),
}));

jest.mock('../templates/emails/upgrade-confirmation', () => ({
  getUpgradeConfirmationEmailHtml: jest.fn().mockResolvedValue('<html>Upgrade</html>'),
  getUpgradeConfirmationEmailSubject: jest.fn().mockReturnValue('Upgrade'),
  UPGRADE_CONFIRMATION_TEMPLATE_VERSION: '1.0',
}));

jest.mock('../templates/emails/downgrade-notice', () => ({
  getDowngradeNoticeEmailHtml: jest.fn().mockResolvedValue('<html>Downgrade</html>'),
  getDowngradeNoticeEmailSubject: jest.fn().mockReturnValue('Downgrade'),
  DOWNGRADE_NOTICE_TEMPLATE_VERSION: '1.0',
}));

import { downgradeUser } from './subscription.service';

function proUser(overrides: Record<string, unknown> = {}) {
  return {
    isFoundingRider: false,
    subscriptionTier: 'PRO',
    subscriptionProvider: 'APPLE',
    email: 'rider@test.com',
    name: 'Test Rider',
    ...overrides,
  };
}

describe('downgradeUser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should downgrade a PRO user with no provider filter', async () => {
    mockUserFindUnique.mockResolvedValue(proUser({ subscriptionProvider: 'STRIPE' }));

    await downgradeUser('user-1', 'stripe_webhook');

    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: expect.objectContaining({ subscriptionTier: 'FREE', subscriptionProvider: null }),
      })
    );
    expect(mockSendEmailWithAudit).toHaveBeenCalledTimes(1);
  });

  it('should downgrade when the provider is in onlyProviders', async () => {
    mockUserFindUnique.mockResolvedValue(proUser({ subscriptionProvider: 'GOOGLE' }));

    await downgradeUser('user-1', 'revenuecat_webhook', { onlyProviders: ['APPLE', 'GOOGLE'] });

    expect(mockUserUpdate).toHaveBeenCalledTimes(1);
  });

  it('should keep a Stripe subscriber PRO when onlyProviders is IAP', async () => {
    mockUserFindUnique.mockResolvedValue(proUser({ subscriptionProvider: 'STRIPE' }));

    await downgradeUser('user-1', 'revenuecat_webhook', { onlyProviders: ['APPLE', 'GOOGLE'] });

    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockSendEmailWithAudit).not.toHaveBeenCalled();
  });

  it('should keep PRO from the other store', async () => {
    mockUserFindUnique.mockResolvedValue(proUser({ subscriptionProvider: 'GOOGLE' }));

    await downgradeUser('user-1', 'revenuecat_webhook', { onlyProviders: ['APPLE'] });

    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('should keep PRO with no recorded provider when onlyProviders is set', async () => {
    mockUserFindUnique.mockResolvedValue(proUser({ subscriptionProvider: null }));

    await downgradeUser('user-1', 'revenuecat_webhook', { onlyProviders: ['APPLE', 'GOOGLE'] });

    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('should never downgrade a founding rider', async () => {
    mockUserFindUnique.mockResolvedValue(proUser({ isFoundingRider: true }));

    await downgradeUser('user-1', 'revenuecat_webhook', { onlyProviders: ['APPLE'] });

    expect(mockUserUpdate).not.toHaveBeenCalled();
    expect(mockSendEmailWithAudit).not.toHaveBeenCalled();
  });
});
