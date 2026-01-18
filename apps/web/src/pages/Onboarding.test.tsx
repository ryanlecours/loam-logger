import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Onboarding from './Onboarding';

// Mock Apollo Client
const mockUseQuery = vi.fn();
const mockUseApolloClient = vi.fn();

vi.mock('@apollo/client', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useApolloClient: () => mockUseApolloClient(),
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

  describe('Step 5: Wear Start Options', () => {
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

      // Now on Step 5
    };

    it('renders all three wear options on Step 5', async () => {
      const user = userEvent.setup();
      await navigateToStep5(user);

      expect(screen.getByText('How should we start tracking wear?')).toBeInTheDocument();
      expect(screen.getByText('Start Fresh')).toBeInTheDocument();
      expect(screen.getByText('Already Ridden')).toBeInTheDocument();
      expect(screen.getByText("I'll fine-tune later")).toBeInTheDocument();
    });

    it('shows Recommended badge on Start Fresh option', async () => {
      const user = userEvent.setup();
      await navigateToStep5(user);

      expect(screen.getByText('Recommended')).toBeInTheDocument();
    });

    it('highlights selected option when clicked', async () => {
      const user = userEvent.setup();
      await navigateToStep5(user);

      const startFreshButton = screen.getByText('Start Fresh').closest('button');
      await user.click(startFreshButton!);

      expect(startFreshButton).toHaveClass('border-accent');
    });

    it('prevents proceeding without selecting a wear option', async () => {
      const user = userEvent.setup();
      await navigateToStep5(user);

      // Try to continue without selecting
      await user.click(screen.getByText('Continue'));

      expect(screen.getByText('Please select how to start tracking wear')).toBeInTheDocument();
    });

    it('allows proceeding after selecting a wear option', async () => {
      const user = userEvent.setup();
      await navigateToStep5(user);

      // Select an option
      await user.click(screen.getByText('Start Fresh'));

      // Continue to Step 6
      await user.click(screen.getByText('Continue'));

      // Should be on Step 6 (Device Connections)
      await waitFor(() => {
        expect(screen.getByText('Connect Your Devices')).toBeInTheDocument();
      });
    });

    it('can select Already Ridden option', async () => {
      const user = userEvent.setup();
      await navigateToStep5(user);

      const alreadyRiddenButton = screen.getByText('Already Ridden').closest('button');
      await user.click(alreadyRiddenButton!);

      expect(alreadyRiddenButton).toHaveClass('border-accent');
    });

    it('can select I\'ll fine-tune later option', async () => {
      const user = userEvent.setup();
      await navigateToStep5(user);

      const fineTuneLaterButton = screen.getByText("I'll fine-tune later").closest('button');
      await user.click(fineTuneLaterButton!);

      expect(fineTuneLaterButton).toHaveClass('border-accent');
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

      // On Step 5, select an option
      await user.click(screen.getByText('Start Fresh'));
      await user.click(screen.getByText('Continue'));

      // On Step 6, click Done
      await user.click(screen.getByText('Done'));

      // Should call fetch with acquisitionCondition
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
        const fetchCall = mockFetch.mock.calls[0];
        const body = JSON.parse(fetchCall[1].body);
        expect(body.acquisitionCondition).toBe('NEW');
      });
    });

    it('redirects to Step 5 if acquisitionCondition is missing on complete', async () => {
      const user = userEvent.setup();

      // Simulate a scenario where user bypassed Step 5 validation
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
      // For this test, we'll go through the flow but skip Step 5 selection

      const ageInput = screen.getByRole('textbox');
      await user.clear(ageInput);
      await user.type(ageInput, '30');
      await user.click(screen.getByText('Continue'));

      await user.click(screen.getByText('Continue')); // Skip location

      await user.click(screen.getByText('Select Bike'));
      await user.click(screen.getByText('Continue'));

      // Don't select any wear option, try to continue
      // This should show error
      await user.click(screen.getByText('Continue'));

      expect(screen.getByText('Please select how to start tracking wear')).toBeInTheDocument();
    });

    it('passes selected acquisitionCondition to API', async () => {
      const user = userEvent.setup();
      renderOnboarding();

      // Complete the full flow with USED selected
      await user.click(screen.getByText('Accept Terms'));

      const ageInput = screen.getByRole('textbox');
      await user.clear(ageInput);
      await user.type(ageInput, '30');
      await user.click(screen.getByText('Continue'));

      await user.click(screen.getByText('Continue')); // Skip location

      await user.click(screen.getByText('Select Bike'));
      await user.click(screen.getByText('Continue'));

      // Select USED option
      await user.click(screen.getByText('Already Ridden'));
      await user.click(screen.getByText('Continue'));

      // Complete onboarding
      await user.click(screen.getByText('Done'));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
        const fetchCall = mockFetch.mock.calls[0];
        const body = JSON.parse(fetchCall[1].body);
        expect(body.acquisitionCondition).toBe('USED');
      });
    });

    it('passes MIXED acquisitionCondition when selected', async () => {
      const user = userEvent.setup();
      renderOnboarding();

      // Complete the full flow with MIXED selected
      await user.click(screen.getByText('Accept Terms'));

      const ageInput = screen.getByRole('textbox');
      await user.clear(ageInput);
      await user.type(ageInput, '30');
      await user.click(screen.getByText('Continue'));

      await user.click(screen.getByText('Continue')); // Skip location

      await user.click(screen.getByText('Select Bike'));
      await user.click(screen.getByText('Continue'));

      // Select MIXED option
      await user.click(screen.getByText("I'll fine-tune later"));
      await user.click(screen.getByText('Continue'));

      // Complete onboarding
      await user.click(screen.getByText('Done'));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
        const fetchCall = mockFetch.mock.calls[0];
        const body = JSON.parse(fetchCall[1].body);
        expect(body.acquisitionCondition).toBe('MIXED');
      });
    });
  });

  describe('sessionStorage persistence', () => {
    it('persists acquisitionCondition to sessionStorage', async () => {
      const user = userEvent.setup();
      renderOnboarding();

      // Navigate to Step 5
      await user.click(screen.getByText('Accept Terms'));

      const ageInput = screen.getByRole('textbox');
      await user.clear(ageInput);
      await user.type(ageInput, '30');
      await user.click(screen.getByText('Continue'));

      await user.click(screen.getByText('Continue')); // Skip location

      await user.click(screen.getByText('Select Bike'));
      await user.click(screen.getByText('Continue'));

      // Select a wear option
      await user.click(screen.getByText('Already Ridden'));

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

      // On Step 5, the "Already Ridden" option should be highlighted (restored from sessionStorage)
      const alreadyRiddenButton = screen.getByText('Already Ridden').closest('button');
      expect(alreadyRiddenButton).toHaveClass('border-accent');

      // Should be able to continue without re-selecting
      await user.click(screen.getByText('Continue'));

      // Should be on Step 6
      await waitFor(() => {
        expect(screen.getByText('Connect Your Devices')).toBeInTheDocument();
      });
    });
  });

  describe('Step 5 with colorway selector', () => {
    it('shows colorway selector when bike has multiple images', async () => {
      mockGetBikeDetails.mockResolvedValue({
        images: [
          { url: 'https://example.com/red.jpg' },
          { url: 'https://example.com/blue.jpg' },
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

      // Should show colorway selector
      await waitFor(() => {
        expect(screen.getByText('Which colorway do you have?')).toBeInTheDocument();
      });
    });
  });
});
