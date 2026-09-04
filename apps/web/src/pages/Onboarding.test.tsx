import { GARMIN_CONNECT_APP_NAME } from '@loam/shared';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import Onboarding from './Onboarding';

// Mock Apollo Client
const mockUseQuery = vi.fn();
const mockUseApolloClient = vi.fn();
const mockUseMutation = vi.fn();

vi.mock('@apollo/client', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useApolloClient: () => mockUseApolloClient(),
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
  gql: vi.fn((strings: TemplateStringsArray) => strings[0]),
}));

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [new URLSearchParams()],
  };
});

// Mock useCurrentUser
vi.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({
    user: { id: 'user-123', name: 'Test User', email: 'test@example.com' },
  }),
}));

// Mock useSpokes
const mockGetBikeDetails = vi.fn();
vi.mock('@/hooks/useSpokes', () => ({
  useSpokes: () => ({
    getBikeDetails: mockGetBikeDetails,
    isLoading: false,
  }),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock getAuthHeaders
vi.mock('@/lib/csrf', () => ({
  getAuthHeaders: () => ({ 'Content-Type': 'application/json' }),
}));

// Mock BikeSearch component
vi.mock('@/components/BikeSearch', () => ({
  BikeSearch: ({ onSelect }: { onSelect: (bike: unknown) => void }) => (
    <div data-testid="bike-search">
      <button
        onClick={() =>
          onSelect({
            id: 'spokes-123',
            maker: 'Santa Cruz',
            model: 'Bronson',
            year: 2024,
          })
        }
      >
        Select Bike
      </button>
    </div>
  ),
}));

// Mock BikeImageSelector component
vi.mock('@/components/BikeImageSelector', () => ({
  BikeImageSelector: () => <div data-testid="bike-image-selector" />,
}));

// Mock TermsAcceptanceStep component
vi.mock('@/components/TermsAcceptanceStep', () => ({
  TermsAcceptanceStep: ({ onComplete }: { onComplete: () => void }) => (
    <div data-testid="terms-step">
      <button onClick={onComplete}>Accept Terms</button>
    </div>
  ),
}));

describe('Onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();

    mockUseQuery.mockReturnValue({
      data: { me: { accounts: [] } },
      refetch: vi.fn(),
    });

    mockUseApolloClient.mockReturnValue({
      query: vi.fn().mockResolvedValue({ data: { me: { id: 'user-123' } } }),
      writeQuery: vi.fn(),
    });

    // Mock useMutation to return a function and loading state
    mockUseMutation.mockReturnValue([vi.fn().mockResolvedValue({ data: {} }), { loading: false }]);

    mockGetBikeDetails.mockResolvedValue(null);

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, bikeId: 'bike-456' }),
    });
  });

  const renderOnboarding = (initialStep = 1) => {
    // Override useSearchParams for specific step
    vi.doMock('react-router', async () => {
      const actual = await vi.importActual('react-router');
      return {
        ...actual,
        useNavigate: () => mockNavigate,
        useSearchParams: () => [new URLSearchParams(`step=${initialStep}`)],
      };
    });

    return render(
      <MemoryRouter>
        <Onboarding />
      </MemoryRouter>
    );
  };

  describe('Step 5: Colorway Selection', () => {
    const navigateToStep5 = async (user: ReturnType<typeof userEvent.setup>) => {
      renderOnboarding();

      // Step 1: Accept terms
      await user.click(screen.getByText('Accept Terms'));

      // Step 2: Enter age
      const ageInput = screen.getByRole('textbox');
      await user.clear(ageInput);
      await user.type(ageInput, '30');
      await user.click(screen.getByText('Continue'));

      // Step 3: Skip location (optional)
      await user.click(screen.getByText('Continue'));

      // Step 4: Select bike
      await user.click(screen.getByText('Select Bike'));
      await user.click(screen.getByText('Continue'));

      // Now on Step 5 (Colorway)
    };

    it('renders colorway step title', async () => {
      const user = userEvent.setup();
      await navigateToStep5(user);

      expect(screen.getByText('Which colorway do you have?')).toBeInTheDocument();
    });

    it('shows message when no colorway options available', async () => {
      const user = userEvent.setup();
      await navigateToStep5(user);

      // With no spokesDetails, should show fallback message
      expect(screen.getByText('No colorway options available for this bike.')).toBeInTheDocument();
    });
  });

  describe('Step 6: Device Connections', () => {
    const navigateToStep6 = async (user: ReturnType<typeof userEvent.setup>) => {
      renderOnboarding();

      // Step 1: Accept terms
      await user.click(screen.getByText('Accept Terms'));

      // Step 2: Enter age
      const ageInput = screen.getByRole('textbox');
      await user.clear(ageInput);
      await user.type(ageInput, '30');
      await user.click(screen.getByText('Continue'));

      // Step 3: Skip location (optional)
      await user.click(screen.getByText('Continue'));

      // Step 4: Select bike
      await user.click(screen.getByText('Select Bike'));
      await user.click(screen.getByText('Continue'));

      // Step 5: Skip colorway
      await user.click(screen.getByText('Continue'));

      // Now on Step 6 (Device Connections)
    };

    it('renders device connections step', async () => {
      const user = userEvent.setup();
      await navigateToStep6(user);

      expect(screen.getByText('Connect Your Devices')).toBeInTheDocument();
    });

    it('shows Strava connect option', async () => {
      const user = userEvent.setup();
      await navigateToStep6(user);

      expect(screen.getByText('Strava')).toBeInTheDocument();
      expect(screen.getByText('Recommended')).toBeInTheDocument();
    });

    it('shows Garmin connect option', async () => {
      const user = userEvent.setup();
      await navigateToStep6(user);

      // Full app name including the trademark symbol. The Garmin API Brand
      // Guidelines forbid abbreviating, truncating or stylizing it, so this
      // asserts the exact rendered string rather than a substring match.
      expect(screen.getByText(GARMIN_CONNECT_APP_NAME)).toBeInTheDocument();
      expect(GARMIN_CONNECT_APP_NAME).toBe('Garmin Connect™');
    });

    it('shows Suunto connect option', async () => {
      const user = userEvent.setup();
      await navigateToStep6(user);

      expect(screen.getByText('Suunto')).toBeInTheDocument();
    });

    it('shows WHOOP connect option', async () => {
      const user = userEvent.setup();
      await navigateToStep6(user);

      expect(screen.getByText('WHOOP')).toBeInTheDocument();
    });

    it('lists only Coros as coming soon', async () => {
      const user = userEvent.setup();
      await navigateToStep6(user);

      // WHOOP had a working OAuth flow and a Settings connect card while this
      // tile still called it unreleased, so riders who owned one were told to
      // wait for something they could already use. That is the regression
      // these three assertions guard.
      expect(screen.getByText('Coros')).toBeInTheDocument();
      expect(screen.queryByText('Coros, Whoop')).not.toBeInTheDocument();
    });

    it('shows Skip for now button', async () => {
      const user = userEvent.setup();
      await navigateToStep6(user);

      expect(screen.getByText('Skip for now')).toBeInTheDocument();
    });

    describe('with a device already connected', () => {
      beforeEach(() => {
        mockUseQuery.mockReturnValue({
          data: { me: { accounts: [{ provider: 'whoop', connectedAt: '2026-09-01T00:00:00Z' }] } },
          refetch: vi.fn(),
        });
      });

      it('labels the secondary action Back rather than Skip for now', async () => {
        const user = userEvent.setup();
        await navigateToStep6(user);

        expect(screen.getByText('Back')).toBeInTheDocument();
        expect(screen.queryByText('Skip for now')).not.toBeInTheDocument();
      });

      it('actually navigates back a step instead of completing onboarding', async () => {
        const user = userEvent.setup();
        await navigateToStep6(user);

        await user.click(screen.getByText('Back'));

        // Step 5 (colorway), not the completion call. This button used to run
        // the skip path, so a rider reaching for Back finished onboarding.
        expect(screen.getByText('Which colorway do you have?')).toBeInTheDocument();
        expect(mockFetch).not.toHaveBeenCalledWith(
          expect.stringContaining('/onboarding/complete'),
          expect.anything()
        );
      });
    });
  });

  describe('handleComplete', () => {
    it('calls onboarding complete endpoint when completing flow', async () => {
      const user = userEvent.setup();
      renderOnboarding();

      // Navigate through all steps
      await user.click(screen.getByText('Accept Terms'));

      const ageInput = screen.getByRole('textbox');
      await user.clear(ageInput);
      await user.type(ageInput, '30');
      await user.click(screen.getByText('Continue'));

      await user.click(screen.getByText('Continue')); // Skip location

      await user.click(screen.getByText('Select Bike'));
      await user.click(screen.getByText('Continue'));

      // Step 5: Skip colorway
      await user.click(screen.getByText('Continue'));

      // On Step 6, click Continue to complete
      await user.click(screen.getByText('Continue'));

      // Should call fetch to complete onboarding
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
        const fetchCall = mockFetch.mock.calls[0];
        expect(fetchCall[0]).toContain('/onboarding/complete');
      });
    });
  });

  describe('Step 5 with colorway selector (bike with multiple images)', () => {
    it('shows colorway selector when bike has multiple images', async () => {
      mockGetBikeDetails.mockResolvedValue({
        images: [
          { url: 'https://example.com/red.jpg', colorKey: 'Red' },
          { url: 'https://example.com/blue.jpg', colorKey: 'Blue' },
        ],
        thumbnailUrl: 'https://example.com/thumb.jpg',
        components: {},
      });

      const user = userEvent.setup();
      renderOnboarding();

      // Navigate to Step 5
      await user.click(screen.getByText('Accept Terms'));

      const ageInput = screen.getByRole('textbox');
      await user.clear(ageInput);
      await user.type(ageInput, '30');
      await user.click(screen.getByText('Continue'));

      await user.click(screen.getByText('Continue'));

      await user.click(screen.getByText('Select Bike'));

      await waitFor(() => {
        expect(mockGetBikeDetails).toHaveBeenCalled();
      });

      await user.click(screen.getByText('Continue'));

      // Step 5 should show colorway selector with title
      await waitFor(() => {
        expect(screen.getByText('Which colorway do you have?')).toBeInTheDocument();
      });

      // Should have the bike image selector component
      expect(screen.getByTestId('bike-image-selector')).toBeInTheDocument();
    });
  });
});
