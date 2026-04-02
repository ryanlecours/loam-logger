const mockCustomersCreate = jest.fn();
const mockCheckoutSessionsCreate = jest.fn();
const mockBillingPortalSessionsCreate = jest.fn();

jest.mock('../lib/stripe', () => ({
  stripe: {
    customers: { create: (...args: unknown[]) => mockCustomersCreate(...args) },
    checkout: { sessions: { create: (...args: unknown[]) => mockCheckoutSessionsCreate(...args) } },
    billingPortal: { sessions: { create: (...args: unknown[]) => mockBillingPortalSessionsCreate(...args) } },
  },
  STRIPE_CONFIG: {
    monthlyPriceId: 'price_monthly',
    annualPriceId: 'price_annual',
  },
}));

const mockUserFindUniqueOrThrow = jest.fn();
const mockUserUpdate = jest.fn();
const mockTransaction = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findUniqueOrThrow: (...args: unknown[]) => mockUserFindUniqueOrThrow(...args),
      update: (...args: unknown[]) => mockUserUpdate(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

jest.mock('../lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { getOrCreateStripeCustomer, createCheckoutSession, createBillingPortalSession } from './stripe.service';

describe('getOrCreateStripeCustomer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return existing stripeCustomerId without creating a new one', async () => {
    mockUserFindUniqueOrThrow.mockResolvedValue({
      id: 'user-1', email: 'test@test.com', name: 'Test', stripeCustomerId: 'cus_existing',
    });

    const result = await getOrCreateStripeCustomer('user-1');

    expect(result).toBe('cus_existing');
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockCustomersCreate).not.toHaveBeenCalled();
  });

  it('should create a new Stripe customer when none exists', async () => {
    mockUserFindUniqueOrThrow.mockResolvedValue({
      id: 'user-1', email: 'test@test.com', name: 'Test', stripeCustomerId: null,
    });

    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        $queryRawUnsafe: jest.fn(), // advisory lock
        user: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({ email: 'test@test.com', name: 'Test', stripeCustomerId: null }),
          update: jest.fn(),
        },
      };
      mockCustomersCreate.mockResolvedValue({ id: 'cus_new' });
      return fn(tx);
    });

    const result = await getOrCreateStripeCustomer('user-1');

    expect(result).toBe('cus_new');
    expect(mockCustomersCreate).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'test@test.com', metadata: { userId: 'user-1' } })
    );
  });

  it('should return existing customer if set by concurrent request inside lock', async () => {
    mockUserFindUniqueOrThrow.mockResolvedValue({
      id: 'user-1', email: 'test@test.com', name: 'Test', stripeCustomerId: null,
    });

    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        $queryRawUnsafe: jest.fn(),
        user: {
          // Inside the lock, another request already set the customer
          findUniqueOrThrow: jest.fn().mockResolvedValue({ email: 'test@test.com', name: 'Test', stripeCustomerId: 'cus_concurrent' }),
          update: jest.fn(),
        },
      };
      return fn(tx);
    });

    const result = await getOrCreateStripeCustomer('user-1');

    expect(result).toBe('cus_concurrent');
    expect(mockCustomersCreate).not.toHaveBeenCalled();
  });
});

describe('createCheckoutSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: user already has a Stripe customer
    mockUserFindUniqueOrThrow.mockResolvedValue({
      id: 'user-1', email: 'test@test.com', name: 'Test', stripeCustomerId: 'cus_123',
    });
  });

  it('should create a monthly checkout session', async () => {
    mockCheckoutSessionsCreate.mockResolvedValue({ id: 'cs_test', url: 'https://checkout.stripe.com/test' });

    const result = await createCheckoutSession('user-1', 'monthly');

    expect(result).toEqual({ sessionId: 'cs_test', url: 'https://checkout.stripe.com/test' });
    expect(mockCheckoutSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_123',
        line_items: [{ price: 'price_monthly', quantity: 1 }],
      })
    );
  });

  it('should create an annual checkout session', async () => {
    mockCheckoutSessionsCreate.mockResolvedValue({ id: 'cs_test', url: 'https://checkout.stripe.com/test' });

    await createCheckoutSession('user-1', 'annual');

    expect(mockCheckoutSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: 'price_annual', quantity: 1 }],
      })
    );
  });
});

describe('createBillingPortalSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserFindUniqueOrThrow.mockResolvedValue({
      id: 'user-1', email: 'test@test.com', name: 'Test', stripeCustomerId: 'cus_123',
    });
  });

  it('should create a billing portal session', async () => {
    mockBillingPortalSessionsCreate.mockResolvedValue({ url: 'https://billing.stripe.com/portal' });

    const result = await createBillingPortalSession('user-1');

    expect(result).toEqual({ url: 'https://billing.stripe.com/portal' });
    expect(mockBillingPortalSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_123' })
    );
  });
});
