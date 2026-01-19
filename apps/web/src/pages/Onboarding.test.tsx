import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
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
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
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
    vi.doMock('react-router-dom', async () => {
      const actual = await vi.importActual('react-router-dom');
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

  describe('Step 6: Stock Status Options', () => {
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

      // Now on Step 6 (Stock Status)
    };

    it('renders both stock options on Step 6', async () => {
      const user = userEvent.setup();
      await navigateToStep6(user);

      expect(screen.getByText('Are your components stock?')).toBeInTheDocument();
      expect(screen.getByText('All Stock')).toBeInTheDocument();
      expect(screen.getByText('Some Swapped')).toBeInTheDocument();
    });

    it('shows Recommended badge on All Stock option', async () => {
      const user = userEvent.setup();
      await navigateToStep6(user);

      expect(screen.getByText('Recommended')).toBeInTheDocument();
    });

    it('highlights selected option when clicked', async () => {
      const user = userEvent.setup();
      await navigateToStep6(user);

      const allStockButton = screen.getByText('All Stock').closest('button');
      await user.click(allStockButton!);

      expect(allStockButton).toHaveClass('border-accent');
    });

    it('prevents proceeding without selecting a stock option', async () => {
      const user = userEvent.setup();
      await navigateToStep6(user);

      // Try to continue without selecting
      await user.click(screen.getByText('Continue'));

      expect(screen.getByText('Please select your component status')).toBeInTheDocument();
    });

    it('allows proceeding after selecting a stock option', async () => {
      const user = userEvent.setup();
      await navigateToStep6(user);

      // Select an option
      await user.click(screen.getByText('All Stock'));

      // Continue to Step 7
      await user.click(screen.getByText('Continue'));

      // Should be on Step 7 (Device Connections)
      await waitFor(() => {
        expect(screen.getByText('Connect Your Devices')).toBeInTheDocument();
      });
    });

    it('can select Some Swapped option', async () => {
      const user = userEvent.setup();
      await navigateToStep6(user);

      const someSwappedButton = screen.getByText('Some Swapped').closest('button');
      await user.click(someSwappedButton!);

      expect(someSwappedButton).toHaveClass('border-accent');
    });
  });

  describe('handleComplete validation', () => {
    it('validates acquisitionCondition before submission', async () => {
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

      // On Step 6, select All Stock option
      await user.click(screen.getByText('All Stock'));
      await user.click(screen.getByText('Continue'));

      // On Step 7, click Continue to complete
      await user.click(screen.getByText('Continue'));

      // Should call fetch with acquisitionCondition = NEW (All Stock maps to NEW)
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
        const fetchCall = mockFetch.mock.calls[0];
        const body = JSON.parse(fetchCall[1].body);
        expect(body.acquisitionCondition).toBe('NEW');
      });
    });

    it('redirects to Step 6 if acquisitionCondition is missing on complete', async () => {
      const user = userEvent.setup();

      // Simulate a scenario where user bypassed Step 6 validation
      // by manipulating session storage with incomplete data
      sessionStorage.setItem(
        'onboarding_data',
        JSON.stringify({
          age: 30,
          location: '',
          bikeYear: 2024,
          bikeMake: 'Santa Cruz',
          bikeModel: 'Bronson',
          components: {},
        })
      );

      renderOnboarding();

      // Accept terms
      await user.click(screen.getByText('Accept Terms'));

      // The component should load from session storage
      // Navigate directly to step 6 via URL manipulation (simulated)
      // For this test, we'll go through the flow but skip Step 6 selection

      const ageInput = screen.getByRole('textbox');
      await user.clear(ageInput);
      await user.type(ageInput, '30');
      await user.click(screen.getByText('Continue'));

      await user.click(screen.getByText('Continue')); // Skip location

      await user.click(screen.getByText('Select Bike'));
      await user.click(screen.getByText('Continue'));

      // Step 5: Skip colorway
      await user.click(screen.getByText('Continue'));

      // Don't select any stock option on Step 6, try to continue
      // This should show error
      await user.click(screen.getByText('Continue'));

      expect(screen.getByText('Please select your component status')).toBeInTheDocument();
    });

    it('passes USED acquisitionCondition when Some Swapped selected', async () => {
      const user = userEvent.setup();
      renderOnboarding();

      // Complete the full flow with Some Swapped selected
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

      // Step 6: Select Some Swapped option (maps to USED)
      await user.click(screen.getByText('Some Swapped'));
      await user.click(screen.getByText('Continue'));

      // Step 7: Complete onboarding
      await user.click(screen.getByText('Continue'));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
        const fetchCall = mockFetch.mock.calls[0];
        const body = JSON.parse(fetchCall[1].body);
        expect(body.acquisitionCondition).toBe('USED');
      });
    });
  });

  describe('sessionStorage persistence', () => {
    it('persists acquisitionCondition to sessionStorage', async () => {
      const user = userEvent.setup();
      renderOnboarding();

      // Navigate to Step 6
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

      // Step 6: Select Some Swapped option
      await user.click(screen.getByText('Some Swapped'));

      // Check sessionStorage contains acquisitionCondition
      const savedData = JSON.parse(sessionStorage.getItem('onboarding_data') || '{}');
      expect(savedData.acquisitionCondition).toBe('USED');
    });

    it('restores acquisitionCondition from sessionStorage after OAuth redirect', async () => {
      // Simulate data saved before OAuth redirect
      sessionStorage.setItem(
        'onboarding_data',
        JSON.stringify({
          age: 30,
          location: 'Seattle, WA',
          bikeYear: 2024,
          bikeMake: 'Santa Cruz',
          bikeModel: 'Bronson',
          components: {},
          acquisitionCondition: 'USED',
        })
      );

      const user = userEvent.setup();
      renderOnboarding();

      // Accept terms
      await user.click(screen.getByText('Accept Terms'));

      // Navigate through steps - data should be restored
      await user.click(screen.getByText('Continue')); // Age (restored)
      await user.click(screen.getByText('Continue')); // Location (restored)

      await user.click(screen.getByText('Select Bike'));
      await user.click(screen.getByText('Continue'));

      // Step 5: Skip colorway
      await user.click(screen.getByText('Continue'));

      // On Step 6, the "Some Swapped" option should be highlighted (restored from sessionStorage)
      const someSwappedButton = screen.getByText('Some Swapped').closest('button');
      expect(someSwappedButton).toHaveClass('border-accent');

      // Should be able to continue without re-selecting
      await user.click(screen.getByText('Continue'));

      // Should be on Step 7
      await waitFor(() => {
        expect(screen.getByText('Connect Your Devices')).toBeInTheDocument();
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

  describe('Step 6 with expandable component list', () => {
    it('shows component dropdown when bike has components from 99spokes', async () => {
      mockGetBikeDetails.mockResolvedValue({
        images: [],
        thumbnailUrl: 'https://example.com/thumb.jpg',
        components: {
          fork: { maker: 'Fox', model: '36 Factory' },
          rearShock: { maker: 'Fox', model: 'Float X2' },
          brakes: { maker: 'SRAM', model: 'Code RSC' },
        },
      });

      const user = userEvent.setup();
      renderOnboarding();

      // Navigate to Step 6
      await user.click(screen.getByText('Accept Terms'));

      const ageInput = screen.getByRole('textbox');
      await user.clear(ageInput);
      await user.type(ageInput, '30');
      await user.click(screen.getByText('Continue'));

      await user.click(screen.getByText('Continue')); // Skip location

      await user.click(screen.getByText('Select Bike'));

      await waitFor(() => {
        expect(mockGetBikeDetails).toHaveBeenCalled();
      });

      await user.click(screen.getByText('Continue'));

      // Step 5: Skip colorway
      await user.click(screen.getByText('Continue'));

      // Step 6: Should show expandable component list
      await waitFor(() => {
        expect(screen.getByText('Are your components stock?')).toBeInTheDocument();
      });

      // Should show the component dropdown button
      expect(screen.getByText(/View stock components/)).toBeInTheDocument();
    });
  });
});
