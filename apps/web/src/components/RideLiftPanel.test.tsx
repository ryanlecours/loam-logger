import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockUseQuery = vi.fn();
const mockSaveChoice = vi.fn();
const mockUseMutation = vi.fn();
vi.mock('@apollo/client', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
  gql: (strings: TemplateStringsArray) => strings.join(''),
}));

vi.mock('../hooks/usePreferences', () => ({
  usePreferences: () => ({ distanceUnit: 'km' }),
}));

import RideLiftPanel from './RideLiftPanel';

const segment = (liftName: string | null, kind: string | null) => ({
  startTime: '2026-08-01T10:00:00.000Z',
  liftName,
  kind,
});

const rideWith = (lift: unknown, counted = 500) => ({
  data: {
    ride: {
      __typename: 'Ride',
      id: 'ride-1',
      elevationGainMeters: 2000,
      countedElevationGainMeters: counted,
      lift,
    },
  },
});

const defaultLift = {
  elevationGainMeters: 1500,
  countElevation: false,
  countElevationChoice: null,
  segments: [
    segment('Garbanzo Express', 'CHAIRLIFT'),
    segment('Fitzsimmons Express', 'CHAIRLIFT'),
    segment('Garbanzo Express', 'CHAIRLIFT'),
  ],
};

describe('RideLiftPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseMutation.mockReturnValue([mockSaveChoice, { loading: false, error: undefined }]);
    mockSaveChoice.mockResolvedValue({});
  });

  it('renders nothing when no lift was detected', () => {
    mockUseQuery.mockReturnValue(rideWith(null, 2000));
    const { container } = render(<RideLiftPanel rideId="ride-1" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing while the ride is loading', () => {
    mockUseQuery.mockReturnValue({ data: undefined });
    const { container } = render(<RideLiftPanel rideId="ride-1" />);
    expect(container.innerHTML).toBe('');
  });

  it('tags the ride with the lift kind, laps and lift names', () => {
    mockUseQuery.mockReturnValue(rideWith(defaultLift));
    render(<RideLiftPanel rideId="ride-1" />);

    expect(screen.getByText('Chairlift detected')).toBeInTheDocument();
    expect(screen.getByText('3 laps on Garbanzo Express, Fitzsimmons Express')).toBeInTheDocument();
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ variables: { id: 'ride-1' } })
    );
  });

  it('says "Lift detected" with no names when the lifts were found from motion alone', () => {
    mockUseQuery.mockReturnValue(
      rideWith({ ...defaultLift, segments: [segment(null, null)] })
    );
    render(<RideLiftPanel rideId="ride-1" />);

    expect(screen.getByText('Lift detected')).toBeInTheDocument();
    expect(screen.getByText('1 lap')).toBeInTheDocument();
  });

  it('shows the default (not counted) with the counted and recorded climb', () => {
    mockUseQuery.mockReturnValue(rideWith(defaultLift));
    render(<RideLiftPanel rideId="ride-1" />);

    const toggle = screen.getByRole('checkbox', { name: /count the lift climb in this ride/i });
    expect(toggle).not.toBeChecked();
    expect(
      screen.getByText('The lift climbed 1,500 m for you, so this ride counts 500 m of the 2,000 m recorded.')
    ).toBeInTheDocument();
  });

  it('credits OpenStreetMap with a link to its copyright page', () => {
    mockUseQuery.mockReturnValue(rideWith(defaultLift));
    render(<RideLiftPanel rideId="ride-1" />);

    const link = screen.getByRole('link', { name: '© OpenStreetMap contributors' });
    expect(link).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
  });

  it('saves "count it" with an optimistic counted climb', () => {
    mockUseQuery.mockReturnValue(rideWith(defaultLift));
    render(<RideLiftPanel rideId="ride-1" />);

    fireEvent.click(screen.getByRole('checkbox'));

    expect(mockSaveChoice).toHaveBeenCalledTimes(1);
    const { variables, optimisticResponse } = mockSaveChoice.mock.calls[0][0];
    expect(variables).toEqual({ rideId: 'ride-1', count: true });
    expect(optimisticResponse.setRideLiftElevation).toMatchObject({
      __typename: 'Ride',
      id: 'ride-1',
      countedElevationGainMeters: 2000,
      lift: { countElevation: true, countElevationChoice: true },
    });
  });

  it('saves "do not count it" and removes the lift share optimistically', () => {
    mockUseQuery.mockReturnValue(
      rideWith({ ...defaultLift, countElevation: true, countElevationChoice: true }, 2000)
    );
    render(<RideLiftPanel rideId="ride-1" />);

    const toggle = screen.getByRole('checkbox');
    expect(toggle).toBeChecked();
    expect(screen.getByText('The lift climbed 1,500 m for you. This ride counts all 2,000 m recorded.')).toBeInTheDocument();

    fireEvent.click(toggle);

    const { variables, optimisticResponse } = mockSaveChoice.mock.calls[0][0];
    expect(variables).toEqual({ rideId: 'ride-1', count: false });
    expect(optimisticResponse.setRideLiftElevation.countedElevationGainMeters).toBe(500);
    expect(optimisticResponse.setRideLiftElevation.lift.countElevation).toBe(false);
  });

  it('disables the toggle while saving and reports a failed save', () => {
    mockUseQuery.mockReturnValue(rideWith(defaultLift));
    mockUseMutation.mockReturnValue([mockSaveChoice, { loading: true, error: new Error('Network down') }]);
    render(<RideLiftPanel rideId="ride-1" />);

    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByText(/couldn't save your choice\. network down/i)).toBeInTheDocument();
  });
});
