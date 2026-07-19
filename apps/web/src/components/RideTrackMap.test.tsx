import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockUseQuery = vi.fn();
const mockRequestTrack = vi.fn();
const mockUseMutation = vi.fn();
vi.mock('@apollo/client', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
  gql: (strings: TemplateStringsArray) => strings.join(''),
}));

// Leaflet needs a real DOM with layout; stub the lazy inner map.
vi.mock('./TrackMapInner', () => ({
  default: ({ points }: { points: [number, number][] }) => (
    <div data-testid="track-map">{points.length} points</div>
  ),
}));

vi.mock('./ui', () => ({
  Button: ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button {...props}>{children}</button>
  ),
}));

import RideTrackMap from './RideTrackMap';

const startPolling = vi.fn();
const stopPolling = vi.fn();

const queryResult = (rideTrack: unknown, loading = false) => ({
  data: rideTrack ? { rideTrack } : undefined,
  loading,
  startPolling,
  stopPolling,
});

describe('RideTrackMap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseMutation.mockReturnValue([mockRequestTrack, { loading: false, error: undefined }]);
    mockRequestTrack.mockResolvedValue({});
  });

  it('renders a skeleton while the initial query loads', () => {
    mockUseQuery.mockReturnValue(queryResult(null, true));
    const { container } = render(<RideTrackMap rideId="ride-1" />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it('renders the map for an AVAILABLE track', async () => {
    mockUseQuery.mockReturnValue(
      queryResult({ status: 'AVAILABLE', points: [[45, -122], [45.01, -122]], sampledFrom: 5000 })
    );
    render(<RideTrackMap rideId="ride-1" />);
    expect(await screen.findByTestId('track-map')).toHaveTextContent('2 points');
  });

  it('renders nothing for UNAVAILABLE rides', () => {
    mockUseQuery.mockReturnValue(
      queryResult({ status: 'UNAVAILABLE', points: null, sampledFrom: null })
    );
    const { container } = render(<RideTrackMap rideId="ride-1" />);
    expect(container.innerHTML).toBe('');
  });

  it('offers "Load route map" for FETCHABLE rides and polls after requesting', async () => {
    mockUseQuery.mockReturnValue(
      queryResult({ status: 'FETCHABLE', points: null, sampledFrom: null })
    );
    render(<RideTrackMap rideId="ride-1" />);

    fireEvent.click(screen.getByRole('button', { name: /load route map/i }));

    await waitFor(() => expect(mockRequestTrack).toHaveBeenCalledTimes(1));
    expect(startPolling).toHaveBeenCalledWith(2500);
    expect(await screen.findByText(/loading route from strava/i)).toBeTruthy();
  });

  it('stops polling once the track becomes AVAILABLE', async () => {
    // First render FETCHABLE, request, then re-render as AVAILABLE.
    mockUseQuery.mockReturnValue(
      queryResult({ status: 'FETCHABLE', points: null, sampledFrom: null })
    );
    const { rerender } = render(<RideTrackMap rideId="ride-1" />);
    fireEvent.click(screen.getByRole('button', { name: /load route map/i }));
    await waitFor(() => expect(startPolling).toHaveBeenCalled());

    mockUseQuery.mockReturnValue(
      queryResult({ status: 'AVAILABLE', points: [[45, -122]], sampledFrom: 100 })
    );
    rerender(<RideTrackMap rideId="ride-1" />);

    await waitFor(() => expect(stopPolling).toHaveBeenCalled());
  });
});
