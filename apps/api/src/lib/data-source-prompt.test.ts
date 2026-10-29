const mockFindMany = jest.fn();

jest.mock('./prisma', () => ({
  prisma: {
    userAccount: { findMany: mockFindMany },
  },
}));

import { shouldPromptForDataSource } from './data-source-prompt';

describe('shouldPromptForDataSource', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('only counts ride providers, never the sign-in providers', async () => {
    mockFindMany.mockResolvedValue([{ provider: 'strava' }]);

    await shouldPromptForDataSource('user-1');

    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        provider: { in: ['garmin', 'strava', 'whoop', 'suunto'] },
      },
      select: { provider: true },
    });
  });

  it('is false with a single ride provider', async () => {
    mockFindMany.mockResolvedValue([{ provider: 'suunto' }]);

    await expect(shouldPromptForDataSource('user-1')).resolves.toBe(false);
  });

  it('is false with no ride providers', async () => {
    mockFindMany.mockResolvedValue([]);

    await expect(shouldPromptForDataSource('user-1')).resolves.toBe(false);
  });

  it.each([
    ['suunto', 'whoop'],
    ['whoop', 'strava'],
    ['garmin', 'suunto'],
    ['garmin', 'strava'],
  ])('is true once %s and %s are both connected', async (a, b) => {
    mockFindMany.mockResolvedValue([{ provider: a }, { provider: b }]);

    await expect(shouldPromptForDataSource('user-1')).resolves.toBe(true);
  });

  it('is true with three or more providers', async () => {
    mockFindMany.mockResolvedValue([
      { provider: 'garmin' },
      { provider: 'strava' },
      { provider: 'whoop' },
    ]);

    await expect(shouldPromptForDataSource('user-1')).resolves.toBe(true);
  });
});
