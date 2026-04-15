import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import WeatherBackfillSection from './WeatherBackfillSection';

const mockBackfill = vi.fn();
const mockRefetchQueries = vi.fn().mockResolvedValue(undefined);
const mockUseQuery = vi.fn();
const mockUseUserTier = vi.fn();
const mockNavigate = vi.fn();

vi.mock('@apollo/client', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: vi.fn(() => [mockBackfill, { loading: false }]),
  useApolloClient: vi.fn(() => ({ refetchQueries: mockRefetchQueries })),
  gql: vi.fn((strings: TemplateStringsArray) => strings[0]),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom'
  );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../hooks/useUserTier', () => ({
  useUserTier: () => mockUseUserTier(),
}));

const renderSection = () =>
  render(
    <MemoryRouter>
      <WeatherBackfillSection />
    </MemoryRouter>
  );

describe('WeatherBackfillSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQuery.mockReturnValue({
      data: { me: { id: 'user-1', ridesMissingWeather: 42 } },
    });
    mockUseUserTier.mockReturnValue({ isPro: true });
  });

  it('renders nothing when there are no rides missing weather', () => {
    mockUseQuery.mockReturnValueOnce({
      data: { me: { id: 'user-1', ridesMissingWeather: 0 } },
    });
    const { container } = renderSection();
    expect(container.firstChild).toBeNull();
  });

  it('shows the missing-rides count and a Fetch button for Pro users', () => {
    renderSection();
    expect(screen.getByText(/42 rides missing weather data/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /fetch weather/i })).toBeEnabled();
  });

  it('shows a Pro feature chip for free users and routes to /pricing on click', () => {
    mockUseUserTier.mockReturnValueOnce({ isPro: false });
    renderSection();
    const btn = screen.getByRole('button', { name: /pro feature/i });
    fireEvent.click(btn);
    expect(mockNavigate).toHaveBeenCalledWith('/pricing');
    expect(mockBackfill).not.toHaveBeenCalled();
  });

  it('does not call backfill mutation when a free user clicks', () => {
    mockUseUserTier.mockReturnValueOnce({ isPro: false });
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: /pro feature/i }));
    expect(mockBackfill).not.toHaveBeenCalled();
  });

  it('shows "Fetch more" when the backfill reports remainingAfterBatch > 0', async () => {
    mockBackfill.mockResolvedValueOnce({
      data: {
        backfillWeatherForMyRides: {
          enqueuedCount: 500,
          remainingAfterBatch: 350,
          ridesWithoutCoords: 0,
        },
      },
    });

    renderSection();
    fireEvent.click(screen.getByRole('button', { name: /fetch weather/i }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /fetch more/i })
      ).toBeEnabled();
    });
    expect(screen.getByText(/350 more remain/i)).toBeInTheDocument();
  });

  it('disables the button and labels it Queued when the drain completes', async () => {
    mockBackfill.mockResolvedValueOnce({
      data: {
        backfillWeatherForMyRides: {
          enqueuedCount: 42,
          remainingAfterBatch: 0,
          ridesWithoutCoords: 0,
        },
      },
    });

    renderSection();
    fireEvent.click(screen.getByRole('button', { name: /fetch weather/i }));

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /queued/i });
      expect(btn).toBeDisabled();
    });
  });

  it('surfaces ridesWithoutCoords as a caption when > 0', async () => {
    mockBackfill.mockResolvedValueOnce({
      data: {
        backfillWeatherForMyRides: {
          enqueuedCount: 10,
          remainingAfterBatch: 0,
          ridesWithoutCoords: 7,
        },
      },
    });

    renderSection();
    fireEvent.click(screen.getByRole('button', { name: /fetch weather/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/7 rides can't get weather/i)
      ).toBeInTheDocument();
    });
  });

  it('shows a user-visible error when the mutation throws', async () => {
    mockBackfill.mockRejectedValueOnce(new Error('Rate limit exceeded.'));

    renderSection();
    fireEvent.click(screen.getByRole('button', { name: /fetch weather/i }));

    await waitFor(() => {
      expect(screen.getByText(/rate limit exceeded/i)).toBeInTheDocument();
    });
  });
});
