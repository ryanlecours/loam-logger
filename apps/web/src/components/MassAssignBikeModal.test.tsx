import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MassAssignBikeModal } from './MassAssignBikeModal';
import type { UnassignedRideSummary } from '../graphql/unassignedRides';

const mockAssignBikeToRides = vi.fn();
vi.mock('../graphql/importSession', () => ({
  useAssignBikeToRides: () => [mockAssignBikeToRides],
}));

// The modal reads its selection from the server rather than from a list of
// rides handed in as a prop, so the tests drive it through these two hooks.
const mockFetchRideIds = vi.fn();
const mockRefetchSummary = vi.fn();
let summaryResult: { data?: { unassignedRideSummary: UnassignedRideSummary }; loading: boolean };
let lastSummaryFilter: unknown;

vi.mock('../graphql/unassignedRides', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../graphql/unassignedRides')>();
  return {
    ...actual,
    useUnassignedRideSummary: (filter: unknown) => {
      lastSummaryFilter = filter;
      return { ...summaryResult, refetch: mockRefetchSummary };
    },
    useUnassignedRideIds: () => [mockFetchRideIds],
  };
});

const summary = (overrides: Partial<UnassignedRideSummary> = {}): UnassignedRideSummary => ({
  totalCount: 2,
  totalDurationSeconds: 7200,
  earliestStartTime: '2026-03-01T12:00:00.000Z',
  latestStartTime: '2026-06-15T12:00:00.000Z',
  byProvider: [
    { provider: 'STRAVA', count: 1 },
    { provider: 'GARMIN', count: 1 },
  ],
  ...overrides,
});

const setSummary = (value: UnassignedRideSummary) => {
  summaryResult = { data: { unassignedRideSummary: value }, loading: false };
};

const createBike = (id: string, nickname: string) => ({
  id,
  nickname,
  manufacturer: 'Trek',
  model: 'Slash',
});

const idsFor = (...ids: string[]) => ({ data: { rides: ids.map((id) => ({ id })) } });

describe('MassAssignBikeModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    bikes: [createBike('bike-1', 'My Trek'), createBike('bike-2', 'My Santa Cruz')],
    onSuccess: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setSummary(summary());
    lastSummaryFilter = undefined;
    mockFetchRideIds.mockResolvedValue(idsFor('ride-1', 'ride-2'));
    mockAssignBikeToRides.mockResolvedValue({
      data: { assignBikeToRides: { success: true, updatedCount: 2 } },
    });
  });

  describe('rendering', () => {
    it('renders modal with title and subtitle', () => {
      render(<MassAssignBikeModal {...defaultProps} />);

      expect(screen.getByText('Mass Assign Bike')).toBeInTheDocument();
      expect(
        screen.getByText('Assign a bike to multiple unassigned rides at once')
      ).toBeInTheDocument();
    });

    it('renders bike selector dropdown', () => {
      render(<MassAssignBikeModal {...defaultProps} />);

      expect(screen.getByText('Select Bike')).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'My Trek' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'My Santa Cruz' })).toBeInTheDocument();
    });

    it('renders date range inputs', () => {
      render(<MassAssignBikeModal {...defaultProps} />);

      expect(screen.getByText('Date Range')).toBeInTheDocument();
      expect(screen.getByLabelText('Start date')).toBeInTheDocument();
      expect(screen.getByLabelText('End date')).toBeInTheDocument();
    });

    it('offers only the providers that actually have unassigned rides', () => {
      render(<MassAssignBikeModal {...defaultProps} />);

      expect(screen.getByLabelText(/All providers/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Strava/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Garmin/)).toBeInTheDocument();
      // A provider the rider has never connected is not a filter worth showing.
      expect(screen.queryByLabelText(/WHOOP/)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/Suunto/)).not.toBeInTheDocument();
    });

    it('shows the hours a bulk assignment would credit', () => {
      setSummary(summary({ totalCount: 12, totalDurationSeconds: 43200 }));

      render(<MassAssignBikeModal {...defaultProps} />);

      // The hours are the consequence: they land on the bike's components and
      // move its service predictions.
      expect(screen.getByText(/About 12 h credited/)).toBeInTheDocument();
      expect(screen.getByText(/Mar 1, 2026 to Jun 15, 2026/)).toBeInTheDocument();
    });

    it('shows message when no bikes available', () => {
      render(<MassAssignBikeModal {...defaultProps} bikes={[]} />);

      expect(screen.getByText(/don't have any bikes/i)).toBeInTheDocument();
    });
  });

  describe('selection', () => {
    it('asks the server for the whole unassigned set, not a loaded page', () => {
      render(<MassAssignBikeModal {...defaultProps} />);

      expect(lastSummaryFilter).toEqual({
        startDate: null,
        endDate: null,
        provider: null,
      });
    });

    it('narrows the selection by provider', () => {
      render(<MassAssignBikeModal {...defaultProps} />);

      fireEvent.click(screen.getByLabelText(/Strava/));

      expect(lastSummaryFilter).toMatchObject({ provider: 'STRAVA' });
    });

    it('narrows the selection by date window', () => {
      render(<MassAssignBikeModal {...defaultProps} />);

      fireEvent.change(screen.getByLabelText('Start date'), {
        target: { value: '2026-06-01' },
      });

      expect(lastSummaryFilter).toMatchObject({
        startDate: new Date('2026-06-01T00:00:00.000').toISOString(),
      });
    });

    it('rejects a backwards date range before querying', () => {
      render(<MassAssignBikeModal {...defaultProps} />);

      fireEvent.change(screen.getByLabelText('Start date'), {
        target: { value: '2026-06-01' },
      });
      fireEvent.change(screen.getByLabelText('End date'), {
        target: { value: '2026-01-01' },
      });

      expect(screen.getByText(/Start date must be before end date/i)).toBeInTheDocument();
    });

    it('shows message when no rides match filters', () => {
      setSummary(summary({ totalCount: 0, totalDurationSeconds: 0, byProvider: [] }));

      render(<MassAssignBikeModal {...defaultProps} />);

      expect(screen.getByText(/No unassigned rides match/i)).toBeInTheDocument();
    });
  });

  describe('bike assignment', () => {
    const selectBike = () => {
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'bike-1' } });
    };

    it('re-reads the ride ids at submit time with the unassigned predicate', async () => {
      render(<MassAssignBikeModal {...defaultProps} />);
      selectBike();

      fireEvent.click(screen.getByRole('button', { name: /Assign 2 Rides/i }));

      await waitFor(() => {
        // `unassigned: true` is what keeps rides the rider marked "not my bike"
        // out of a bulk assignment: the server predicate is
        // { bikeId: null, unownedBike: false }.
        expect(mockFetchRideIds).toHaveBeenCalledWith({
          variables: {
            filter: { startDate: null, endDate: null, provider: null, unassigned: true },
            take: 2000,
          },
        });
      });
      expect(mockAssignBikeToRides).toHaveBeenCalledWith({
        variables: { rideIds: ['ride-1', 'ride-2'], bikeId: 'bike-1' },
      });
    });

    it('splits a large selection across several bounded calls', async () => {
      const ids = Array.from({ length: 1200 }, (_, i) => `ride-${i}`);
      mockFetchRideIds.mockResolvedValue(idsFor(...ids));
      mockAssignBikeToRides.mockResolvedValue({
        data: { assignBikeToRides: { success: true, updatedCount: 500 } },
      });
      setSummary(summary({ totalCount: 1200 }));

      render(<MassAssignBikeModal {...defaultProps} />);
      selectBike();

      fireEvent.click(screen.getByRole('button', { name: /Assign 1200 Rides/i }));

      await waitFor(() => {
        expect(mockAssignBikeToRides).toHaveBeenCalledTimes(3);
      });
      const sizes = mockAssignBikeToRides.mock.calls.map(
        (call) => call[0].variables.rideIds.length
      );
      expect(sizes).toEqual([500, 500, 200]);
    });

    it('reports how much landed when a later chunk fails', async () => {
      const ids = Array.from({ length: 900 }, (_, i) => `ride-${i}`);
      mockFetchRideIds.mockResolvedValue(idsFor(...ids));
      mockAssignBikeToRides
        .mockResolvedValueOnce({
          data: { assignBikeToRides: { success: true, updatedCount: 500 } },
        })
        .mockRejectedValueOnce(new Error('Network error'));
      setSummary(summary({ totalCount: 900 }));

      render(<MassAssignBikeModal {...defaultProps} />);
      selectBike();

      fireEvent.click(screen.getByRole('button', { name: /Assign 900 Rides/i }));

      // Each chunk is its own transaction, so half the work really did land.
      await waitFor(() => {
        expect(screen.getByText(/Assigned 500 rides, then hit an error/i)).toBeInTheDocument();
      });
      expect(defaultProps.onSuccess).toHaveBeenCalled();
    });

    it('tells the rider when more rides remain than one pass can take', async () => {
      const ids = Array.from({ length: 2000 }, (_, i) => `ride-${i}`);
      mockFetchRideIds.mockResolvedValue(idsFor(...ids));
      mockAssignBikeToRides.mockResolvedValue({
        data: { assignBikeToRides: { success: true, updatedCount: 500 } },
      });
      setSummary(summary({ totalCount: 2600 }));

      render(<MassAssignBikeModal {...defaultProps} />);
      selectBike();

      fireEvent.click(screen.getByRole('button', { name: /Assign 2600 Rides/i }));

      await waitFor(() => {
        expect(screen.getByText(/600 more match/i)).toBeInTheDocument();
      });
    });

    it('handles the selection emptying out between preview and submit', async () => {
      mockFetchRideIds.mockResolvedValue(idsFor());

      render(<MassAssignBikeModal {...defaultProps} />);
      selectBike();

      fireEvent.click(screen.getByRole('button', { name: /Assign 2 Rides/i }));

      await waitFor(() => {
        expect(screen.getByText(/already have bikes/i)).toBeInTheDocument();
      });
      expect(mockAssignBikeToRides).not.toHaveBeenCalled();
    });

    it('shows success message after assignment', async () => {
      render(<MassAssignBikeModal {...defaultProps} />);
      selectBike();

      fireEvent.click(screen.getByRole('button', { name: /Assign 2 Rides/i }));

      await waitFor(() => {
        expect(screen.getByText(/Assigned 2 rides to bike/i)).toBeInTheDocument();
      });
    });

    it('calls onSuccess after successful assignment', async () => {
      const onSuccess = vi.fn();
      render(<MassAssignBikeModal {...defaultProps} onSuccess={onSuccess} />);
      selectBike();

      fireEvent.click(screen.getByRole('button', { name: /Assign 2 Rides/i }));

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalled();
      });
    });

    it('shows error message on failure', async () => {
      mockAssignBikeToRides.mockRejectedValue(new Error('Network error'));

      render(<MassAssignBikeModal {...defaultProps} />);
      selectBike();

      fireEvent.click(screen.getByRole('button', { name: /Assign 2 Rides/i }));

      await waitFor(() => {
        expect(screen.getByText(/Failed to assign rides/i)).toBeInTheDocument();
      });
    });

    it('disables assign button when no bike selected', () => {
      render(<MassAssignBikeModal {...defaultProps} />);

      expect(screen.getByRole('button', { name: /Assign/i })).toBeDisabled();
    });

    it('disables assign button when no matching rides', () => {
      setSummary(summary({ totalCount: 0, totalDurationSeconds: 0, byProvider: [] }));

      render(<MassAssignBikeModal {...defaultProps} />);
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'bike-1' } });

      expect(screen.getByRole('button', { name: /Assign 0 Rides/i })).toBeDisabled();
    });
  });

  describe('modal controls', () => {
    it('calls onClose when Cancel button clicked', () => {
      const onClose = vi.fn();
      render(<MassAssignBikeModal {...defaultProps} onClose={onClose} />);

      fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));

      expect(onClose).toHaveBeenCalled();
    });

    it('auto-selects bike when only one bike available', () => {
      render(<MassAssignBikeModal {...defaultProps} bikes={[createBike('bike-1', 'Only Bike')]} />);

      expect(screen.getByRole('combobox')).toHaveValue('bike-1');
    });

    it('resets state when modal opens', () => {
      const { rerender } = render(<MassAssignBikeModal {...defaultProps} isOpen={false} />);

      rerender(<MassAssignBikeModal {...defaultProps} isOpen={true} />);

      expect(screen.getByLabelText(/All providers/)).toBeChecked();
    });
  });

  describe('preview text', () => {
    it('shows singular "ride" for 1 ride', () => {
      setSummary(summary({ totalCount: 1 }));

      render(<MassAssignBikeModal {...defaultProps} />);

      expect(screen.getByText(/unassigned ride will be assigned/i)).toBeInTheDocument();
    });

    it('shows plural "rides" for multiple rides', () => {
      render(<MassAssignBikeModal {...defaultProps} />);

      expect(screen.getByText(/unassigned rides will be assigned/i)).toBeInTheDocument();
    });

    it('shows selected bike name in preview', () => {
      render(<MassAssignBikeModal {...defaultProps} />);

      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'bike-1' } });

      const trekElements = screen.getAllByText(/My Trek/);
      expect(trekElements.length).toBeGreaterThanOrEqual(2);
    });
  });
});
