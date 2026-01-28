import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MassAssignBikeModal } from './MassAssignBikeModal';
import type { Ride } from '../models/Ride';

// Mock the GraphQL mutation hook
const mockAssignBikeToRides = vi.fn();
vi.mock('../graphql/importSession', () => ({
  useAssignBikeToRides: () => [mockAssignBikeToRides],
}));

// Helper to create test rides
const createRide = (overrides: Partial<Ride> = {}): Ride => ({
  id: `ride-${Math.random().toString(36).slice(2)}`,
  startTime: '2024-06-15T12:00:00Z',
  durationSeconds: 3600,
  distanceMiles: 10,
  elevationGainFeet: 500,
  rideType: 'Trail',
  bikeId: null,
  averageHr: null,
  notes: null,
  trailSystem: null,
  location: null,
  stravaActivityId: null,
  garminActivityId: null,
  whoopWorkoutId: null,
  ...overrides,
});

// Helper to create test bikes
const createBike = (id: string, nickname: string) => ({
  id,
  nickname,
  manufacturer: 'Trek',
  model: 'Slash',
});

describe('MassAssignBikeModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    rides: [
      createRide({ id: 'ride-1', bikeId: null }),
      createRide({ id: 'ride-2', bikeId: null }),
      createRide({ id: 'ride-3', bikeId: 'existing-bike' }),
    ],
    bikes: [
      createBike('bike-1', 'My Trek'),
      createBike('bike-2', 'My Santa Cruz'),
    ],
    onSuccess: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAssignBikeToRides.mockResolvedValue({
      data: { assignBikeToRides: { success: true, updatedCount: 2 } },
    });
  });

  describe('rendering', () => {
    it('renders modal with title and subtitle', () => {
      render(<MassAssignBikeModal {...defaultProps} />);

      expect(screen.getByText('Mass Assign Bike')).toBeInTheDocument();
      expect(screen.getByText('Assign a bike to multiple unassigned rides at once')).toBeInTheDocument();
    });

    it('renders bike selector dropdown', () => {
      render(<MassAssignBikeModal {...defaultProps} />);

      expect(screen.getByText('Select Bike')).toBeInTheDocument();
      expect(screen.getByRole('combobox')).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'My Trek' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'My Santa Cruz' })).toBeInTheDocument();
    });

    it('renders date range inputs', () => {
      render(<MassAssignBikeModal {...defaultProps} />);

      expect(screen.getByText('Date Range')).toBeInTheDocument();
      // Note: date inputs may be rendered differently, check for container text
      expect(screen.getByText(/optional/i)).toBeInTheDocument();
    });

    it('renders provider filter options', () => {
      render(<MassAssignBikeModal {...defaultProps} />);

      expect(screen.getByText('Provider')).toBeInTheDocument();
      expect(screen.getByLabelText('All providers')).toBeInTheDocument();
      expect(screen.getByLabelText('Strava')).toBeInTheDocument();
      expect(screen.getByLabelText('Garmin')).toBeInTheDocument();
      expect(screen.getByLabelText('WHOOP')).toBeInTheDocument();
      expect(screen.getByLabelText('Manual')).toBeInTheDocument();
    });

    it('shows unassigned ride count in preview', () => {
      render(<MassAssignBikeModal {...defaultProps} />);

      // 2 rides are unassigned (ride-1 and ride-2) - check button text for count
      expect(screen.getByRole('button', { name: /Assign 2 Rides/i })).toBeInTheDocument();
    });

    it('shows message when no bikes available', () => {
      render(<MassAssignBikeModal {...defaultProps} bikes={[]} />);

      expect(screen.getByText(/don't have any bikes/i)).toBeInTheDocument();
    });
  });

  describe('filtering', () => {
    it('filters out rides that already have bikes assigned', () => {
      const rides = [
        createRide({ id: 'ride-1', bikeId: null }),
        createRide({ id: 'ride-2', bikeId: 'some-bike' }),
        createRide({ id: 'ride-3', bikeId: null }),
      ];

      render(<MassAssignBikeModal {...defaultProps} rides={rides} />);

      // Only 2 unassigned rides - check the button text for count
      expect(screen.getByRole('button', { name: /Assign 2 Rides/i })).toBeInTheDocument();
    });

    it('filters by provider when selected', () => {
      const rides = [
        createRide({ id: 'ride-1', bikeId: null, stravaActivityId: 'strava-1' }),
        createRide({ id: 'ride-2', bikeId: null, garminActivityId: 'garmin-1' }),
        createRide({ id: 'ride-3', bikeId: null }), // manual
      ];

      render(<MassAssignBikeModal {...defaultProps} rides={rides} />);

      // Initially all 3 unassigned - check button text
      expect(screen.getByRole('button', { name: /Assign 3 Rides/i })).toBeInTheDocument();

      // Select Strava filter
      fireEvent.click(screen.getByLabelText('Strava'));

      // Should show only 1 Strava ride
      expect(screen.getByRole('button', { name: /Assign 1 Ride$/i })).toBeInTheDocument();
    });

    it('filters by date range', () => {
      const rides = [
        createRide({ id: 'ride-1', bikeId: null, startTime: '2024-01-15T12:00:00Z' }),
        createRide({ id: 'ride-2', bikeId: null, startTime: '2024-06-15T12:00:00Z' }),
        createRide({ id: 'ride-3', bikeId: null, startTime: '2024-12-15T12:00:00Z' }),
      ];

      render(<MassAssignBikeModal {...defaultProps} rides={rides} />);

      // Set start date to filter out January ride
      const startDateInput = screen.getAllByDisplayValue('')[0];
      fireEvent.change(startDateInput, { target: { value: '2024-06-01' } });

      // Should show 2 rides (June and December) - check button text
      expect(screen.getByRole('button', { name: /Assign 2 Rides/i })).toBeInTheDocument();
    });

    it('shows message when no rides match filters', () => {
      const rides = [
        createRide({ id: 'ride-1', bikeId: 'existing' }), // Already assigned
      ];

      render(<MassAssignBikeModal {...defaultProps} rides={rides} />);

      expect(screen.getByText(/No unassigned rides match/i)).toBeInTheDocument();
    });
  });

  describe('bike assignment', () => {
    it('calls mutation with correct ride IDs and bike ID', async () => {
      const rides = [
        createRide({ id: 'ride-1', bikeId: null }),
        createRide({ id: 'ride-2', bikeId: null }),
      ];

      render(<MassAssignBikeModal {...defaultProps} rides={rides} />);

      // Select a bike
      const bikeSelect = screen.getByRole('combobox');
      fireEvent.change(bikeSelect, { target: { value: 'bike-1' } });

      // Click assign button
      const assignButton = screen.getByRole('button', { name: /Assign 2 Rides/i });
      fireEvent.click(assignButton);

      await waitFor(() => {
        expect(mockAssignBikeToRides).toHaveBeenCalledWith({
          variables: {
            rideIds: ['ride-1', 'ride-2'],
            bikeId: 'bike-1',
          },
        });
      });
    });

    it('shows success message after assignment', async () => {
      const rides = [createRide({ id: 'ride-1', bikeId: null })];

      render(<MassAssignBikeModal {...defaultProps} rides={rides} />);

      // Select a bike
      const bikeSelect = screen.getByRole('combobox');
      fireEvent.change(bikeSelect, { target: { value: 'bike-1' } });

      // Click assign button
      const assignButton = screen.getByRole('button', { name: /Assign 1 Ride/i });
      fireEvent.click(assignButton);

      await waitFor(() => {
        expect(screen.getByText(/Assigned.*ride.*to bike/i)).toBeInTheDocument();
      });
    });

    it('calls onSuccess after successful assignment', async () => {
      const onSuccess = vi.fn();
      const rides = [createRide({ id: 'ride-1', bikeId: null })];

      render(<MassAssignBikeModal {...defaultProps} rides={rides} onSuccess={onSuccess} />);

      // Select a bike
      const bikeSelect = screen.getByRole('combobox');
      fireEvent.change(bikeSelect, { target: { value: 'bike-1' } });

      // Click assign button
      const assignButton = screen.getByRole('button', { name: /Assign 1 Ride/i });
      fireEvent.click(assignButton);

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalled();
      });
    });

    it('shows error message on failure', async () => {
      mockAssignBikeToRides.mockRejectedValue(new Error('Network error'));
      const rides = [createRide({ id: 'ride-1', bikeId: null })];

      render(<MassAssignBikeModal {...defaultProps} rides={rides} />);

      // Select a bike
      const bikeSelect = screen.getByRole('combobox');
      fireEvent.change(bikeSelect, { target: { value: 'bike-1' } });

      // Click assign button
      const assignButton = screen.getByRole('button', { name: /Assign 1 Ride/i });
      fireEvent.click(assignButton);

      await waitFor(() => {
        expect(screen.getByText(/Failed to assign rides/i)).toBeInTheDocument();
      });
    });

    it('disables assign button when no bike selected', () => {
      const rides = [createRide({ id: 'ride-1', bikeId: null })];

      render(<MassAssignBikeModal {...defaultProps} rides={rides} />);

      const assignButton = screen.getByRole('button', { name: /Assign/i });
      expect(assignButton).toBeDisabled();
    });

    it('disables assign button when no matching rides', () => {
      const rides = [createRide({ id: 'ride-1', bikeId: 'existing' })];

      render(<MassAssignBikeModal {...defaultProps} rides={rides} />);

      // Select a bike
      const bikeSelect = screen.getByRole('combobox');
      fireEvent.change(bikeSelect, { target: { value: 'bike-1' } });

      const assignButton = screen.getByRole('button', { name: /Assign 0 Rides/i });
      expect(assignButton).toBeDisabled();
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
      const bikes = [createBike('bike-1', 'Only Bike')];

      render(<MassAssignBikeModal {...defaultProps} bikes={bikes} />);

      const bikeSelect = screen.getByRole('combobox');
      expect(bikeSelect).toHaveValue('bike-1');
    });

    it('resets state when modal opens', () => {
      const { rerender } = render(
        <MassAssignBikeModal {...defaultProps} isOpen={false} />
      );

      rerender(<MassAssignBikeModal {...defaultProps} isOpen={true} />);

      // Provider filter should be reset to "all"
      expect(screen.getByLabelText('All providers')).toBeChecked();
    });
  });

  describe('preview text', () => {
    it('shows singular "ride" for 1 ride', () => {
      const rides = [createRide({ id: 'ride-1', bikeId: null })];

      render(<MassAssignBikeModal {...defaultProps} rides={rides} />);

      // Text is split across elements, so check for the count and the word separately
      expect(screen.getByText('1')).toBeInTheDocument();
      expect(screen.getByText(/unassigned ride will be assigned/i)).toBeInTheDocument();
    });

    it('shows plural "rides" for multiple rides', () => {
      const rides = [
        createRide({ id: 'ride-1', bikeId: null }),
        createRide({ id: 'ride-2', bikeId: null }),
      ];

      render(<MassAssignBikeModal {...defaultProps} rides={rides} />);

      // Text is split across elements, so check for the count and the word separately
      expect(screen.getByText('2')).toBeInTheDocument();
      expect(screen.getByText(/unassigned rides will be assigned/i)).toBeInTheDocument();
    });

    it('shows selected bike name in preview', () => {
      const rides = [createRide({ id: 'ride-1', bikeId: null })];

      render(<MassAssignBikeModal {...defaultProps} rides={rides} />);

      // Select a bike
      const bikeSelect = screen.getByRole('combobox');
      fireEvent.change(bikeSelect, { target: { value: 'bike-1' } });

      // "My Trek" appears in both dropdown option and preview text
      const trekElements = screen.getAllByText(/My Trek/);
      expect(trekElements.length).toBeGreaterThanOrEqual(2);
    });
  });
});
