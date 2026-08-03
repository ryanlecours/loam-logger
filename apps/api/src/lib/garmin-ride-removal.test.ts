const mockRideFindUnique = jest.fn();
const mockRideDelete = jest.fn();
const mockTransaction = jest.fn();

jest.mock('./prisma', () => ({
  prisma: {
    ride: { findUnique: mockRideFindUnique, delete: mockRideDelete },
    $transaction: (cb: unknown) => mockTransaction(cb),
  },
}));

const mockSyncBikeComponentHours = jest.fn();
const mockFindAdjusted = jest.fn();
const mockRecomputeAdjusted = jest.fn();

jest.mock('./component-hours', () => ({
  syncBikeComponentHours: (...a: unknown[]) => mockSyncBikeComponentHours(...a),
  findAdjustedComponentIdsForRides: (...a: unknown[]) => mockFindAdjusted(...a),
  recomputeAdjustedComponentsForRides: (...a: unknown[]) => mockRecomputeAdjusted(...a),
}));

const mockInvalidate = jest.fn();
jest.mock('../services/prediction/cache', () => ({
  invalidateBikePredictionsForBikes: (...a: unknown[]) => mockInvalidate(...a),
}));

jest.mock('./logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));

import { removeGarminRideIfPresent } from './garmin-ride-removal';

const tx = {
  ride: { findUnique: mockRideFindUnique, delete: mockRideDelete },
};

beforeEach(() => {
  jest.clearAllMocks();
  // Run the interactive-transaction callback against the mocked client, or the
  // assertions below would pass without the code ever executing.
  mockTransaction.mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx));
  mockFindAdjusted.mockResolvedValue([]);
  mockRecomputeAdjusted.mockResolvedValue([]);
  mockSyncBikeComponentHours.mockResolvedValue([]);
});

describe('removeGarminRideIfPresent', () => {
  const RIDE = {
    id: 'ride-1',
    userId: 'user-1',
    durationSeconds: 5340,
    bikeId: 'bike-1',
  };

  /**
   * The rider retyped the activity in Garmin Connect, so it was never a ride.
   * Leaving it behind would keep crediting its hours against installed
   * components and inflate every service prediction that depends on them.
   */
  it('reverses the hours and deletes the ride', async () => {
    mockRideFindUnique.mockResolvedValue(RIDE);
    mockSyncBikeComponentHours.mockResolvedValue(['bike-1']);

    const removed = await removeGarminRideIfPresent('user-1', 'summary-456');

    expect(removed).toBe(true);
    expect(mockSyncBikeComponentHours).toHaveBeenCalledWith(
      tx,
      'user-1',
      { bikeId: 'bike-1', durationSeconds: 5340 },
      { bikeId: null, durationSeconds: 0 }
    );
    expect(mockRideDelete).toHaveBeenCalledWith({ where: { id: 'ride-1' } });
  });

  // Adjustment rows cascade away with the ride, and the bulk decrement never
  // touches the components a cross-bike INCLUDE points at, so they have to be
  // captured before the delete and recomputed after.
  it('captures cross-bike adjustments before deleting', async () => {
    mockRideFindUnique.mockResolvedValue(RIDE);
    mockFindAdjusted.mockResolvedValue(['comp-9']);

    await removeGarminRideIfPresent('user-1', 'summary-456');

    expect(mockFindAdjusted).toHaveBeenCalledWith(tx, ['ride-1']);
    expect(mockRecomputeAdjusted).toHaveBeenCalledWith(tx, { componentIds: ['comp-9'] });
    const capturedAt = mockFindAdjusted.mock.invocationCallOrder[0];
    const deletedAt = mockRideDelete.mock.invocationCallOrder[0];
    expect(capturedAt).toBeLessThan(deletedAt);
  });

  it('busts the prediction cache for every bike whose hours moved', async () => {
    mockRideFindUnique.mockResolvedValue(RIDE);
    mockSyncBikeComponentHours.mockResolvedValue(['bike-1']);
    mockRecomputeAdjusted.mockResolvedValue(['bike-2']);

    await removeGarminRideIfPresent('user-1', 'summary-456');

    expect(mockInvalidate).toHaveBeenCalledWith('user-1', ['bike-1', 'bike-2']);
  });

  // Most non-cycling activities were never imported at all. That is the common
  // case and must stay a single lookup with no writes.
  it('does nothing when no ride exists', async () => {
    mockRideFindUnique.mockResolvedValue(null);

    const removed = await removeGarminRideIfPresent('user-1', 'summary-456');

    expect(removed).toBe(false);
    expect(mockRideDelete).not.toHaveBeenCalled();
    expect(mockSyncBikeComponentHours).not.toHaveBeenCalled();
    expect(mockInvalidate).not.toHaveBeenCalled();
  });

  // The activity id is unique, so this only fires if a row were ever attributed
  // to the wrong account. A delete is not the place to assume that cannot
  // happen.
  it('refuses to delete another account\u2019s ride', async () => {
    mockRideFindUnique.mockResolvedValue({ ...RIDE, userId: 'someone-else' });

    const removed = await removeGarminRideIfPresent('user-1', 'summary-456');

    expect(removed).toBe(false);
    expect(mockRideDelete).not.toHaveBeenCalled();
  });

  // An unassigned ride is still deleted but moves nobody's hours, so an empty
  // affected-bike list must not read as "nothing happened".
  it('reports removal for a ride with no bike assigned', async () => {
    mockRideFindUnique.mockResolvedValue({ ...RIDE, bikeId: null });

    const removed = await removeGarminRideIfPresent('user-1', 'summary-456');

    expect(removed).toBe(true);
    expect(mockRideDelete).toHaveBeenCalled();
    expect(mockInvalidate).not.toHaveBeenCalled();
  });
});
