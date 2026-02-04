import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BikeServicePreferencesEditor from './BikeServicePreferencesEditor';

// Mock Apollo Client
const mockUpdatePreferences = vi.fn();

vi.mock('@apollo/client', () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(() => [mockUpdatePreferences, { loading: false }]),
  gql: vi.fn((strings: TemplateStringsArray) => strings[0]),
}));

// Mock react-icons/fa
vi.mock('react-icons/fa', () => ({
  FaToggleOn: () => <span>FaToggleOn</span>,
  FaToggleOff: () => <span>FaToggleOff</span>,
  FaUndo: () => <span>FaUndo</span>,
}));

// Import useQuery after mocking to get the mocked version
import { useQuery } from '@apollo/client';
const mockUseQuery = useQuery as ReturnType<typeof vi.fn>;

describe('BikeServicePreferencesEditor', () => {
  const defaultProps = {
    bikeId: 'bike-123',
    bikeServicePreferences: [],
    onSaved: vi.fn(),
  };

  const mockDefaults = {
    servicePreferenceDefaults: [
      {
        componentType: 'FORK',
        displayName: 'Fork',
        defaultInterval: 50,
        defaultIntervalFront: null,
        defaultIntervalRear: null,
      },
      {
        componentType: 'SHOCK',
        displayName: 'Rear Shock',
        defaultInterval: 50,
        defaultIntervalFront: null,
        defaultIntervalRear: null,
      },
      {
        componentType: 'CHAIN',
        displayName: 'Chain',
        defaultInterval: 70,
        defaultIntervalFront: null,
        defaultIntervalRear: null,
      },
    ],
  };

  const mockUserPrefs = {
    me: {
      id: 'user-123',
      servicePreferences: [
        { id: 'pref-1', componentType: 'FORK', trackingEnabled: true, customInterval: 60 },
        { id: 'pref-2', componentType: 'CHAIN', trackingEnabled: false, customInterval: null },
      ],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdatePreferences.mockResolvedValue({ data: { updateBikeServicePreferences: [] } });
  });

  const setupMockQueries = (
    defaults = mockDefaults,
    userPrefs = mockUserPrefs,
    loadingDefaults = false,
    loadingUserPrefs = false
  ) => {
    mockUseQuery.mockImplementation((query: unknown) => {
      const queryStr = String(query);
      if (queryStr.includes('ServicePreferenceDefaults')) {
        return { data: defaults, loading: loadingDefaults };
      }
      if (queryStr.includes('UserServicePreferences')) {
        return { data: userPrefs, loading: loadingUserPrefs };
      }
      return { data: null, loading: false };
    });
  };

  describe('rendering', () => {
    it('shows loading state while fetching preferences', () => {
      setupMockQueries(mockDefaults, mockUserPrefs, true, false);
      render(<BikeServicePreferencesEditor {...defaultProps} />);

      expect(screen.getByText('Loading preferences...')).toBeInTheDocument();
    });

    it('renders component list after loading', () => {
      setupMockQueries();
      render(<BikeServicePreferencesEditor {...defaultProps} />);

      expect(screen.getByText('Fork')).toBeInTheDocument();
      expect(screen.getByText('Rear Shock')).toBeInTheDocument();
      expect(screen.getByText('Chain')).toBeInTheDocument();
    });

    it('shows "Global" badge for components without overrides', () => {
      setupMockQueries();
      render(<BikeServicePreferencesEditor {...defaultProps} />);

      const globalBadges = screen.getAllByText('Global');
      expect(globalBadges.length).toBeGreaterThan(0);
    });

    it('shows "Overridden" badge for components with bike-level overrides', () => {
      setupMockQueries();
      const bikePrefs = [
        { id: 'bp-1', componentType: 'FORK', trackingEnabled: false, customInterval: null },
      ];
      render(<BikeServicePreferencesEditor {...defaultProps} bikeServicePreferences={bikePrefs} />);

      expect(screen.getByText('Overridden')).toBeInTheDocument();
    });

    it('renders override button for each component', () => {
      setupMockQueries();
      render(<BikeServicePreferencesEditor {...defaultProps} />);

      const overrideButtons = screen.getAllByText('Override');
      expect(overrideButtons.length).toBe(3); // One for each component
    });

    it('shows description text about global settings', () => {
      setupMockQueries();
      render(<BikeServicePreferencesEditor {...defaultProps} />);

      expect(
        screen.getByText(/Override global settings for this bike/)
      ).toBeInTheDocument();
    });
  });

  describe('override toggle', () => {
    it('shows "Use global" button when component has override', () => {
      setupMockQueries();
      const bikePrefs = [
        { id: 'bp-1', componentType: 'FORK', trackingEnabled: true, customInterval: 40 },
      ];
      render(<BikeServicePreferencesEditor {...defaultProps} bikeServicePreferences={bikePrefs} />);

      expect(screen.getByText('Use global')).toBeInTheDocument();
    });

    it('creates override when clicking Override button', async () => {
      setupMockQueries();
      render(<BikeServicePreferencesEditor {...defaultProps} />);

      const overrideButtons = screen.getAllByText('Override');
      fireEvent.click(overrideButtons[0]); // Click first Override button (Fork)

      // Should now show "Use global" instead
      await waitFor(() => {
        expect(screen.getByText('Use global')).toBeInTheDocument();
      });

      // Should show unsaved changes indicator
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    });

    it('removes override when clicking Use global button', async () => {
      setupMockQueries();
      const bikePrefs = [
        { id: 'bp-1', componentType: 'FORK', trackingEnabled: false, customInterval: null },
      ];
      render(<BikeServicePreferencesEditor {...defaultProps} bikeServicePreferences={bikePrefs} />);

      const useGlobalButton = screen.getByText('Use global');
      fireEvent.click(useGlobalButton);

      // Fork should now show "Override" button instead
      await waitFor(() => {
        const overrideButtons = screen.getAllByText('Override');
        expect(overrideButtons.length).toBe(3);
      });
    });
  });

  describe('tracking toggle', () => {
    it('shows tracking toggle when component has override', () => {
      setupMockQueries();
      const bikePrefs = [
        { id: 'bp-1', componentType: 'FORK', trackingEnabled: true, customInterval: null },
      ];
      render(<BikeServicePreferencesEditor {...defaultProps} bikeServicePreferences={bikePrefs} />);

      // Find the Fork card and check for tracking status within it
      const forkLabel = screen.getByText('Fork');
      const forkCard = forkLabel.closest('.p-3');
      expect(forkCard?.textContent).toContain('Tracking enabled');
    });

    it('toggles tracking status when clicking toggle', async () => {
      setupMockQueries();
      const bikePrefs = [
        { id: 'bp-1', componentType: 'FORK', trackingEnabled: true, customInterval: null },
      ];
      render(<BikeServicePreferencesEditor {...defaultProps} bikeServicePreferences={bikePrefs} />);

      // Find the Fork card and click its toggle button
      const forkLabel = screen.getByText('Fork');
      const forkCard = forkLabel.closest('.p-3');
      const toggleButton = forkCard?.querySelector('button[title]');
      if (toggleButton) {
        fireEvent.click(toggleButton);
      }

      // Re-query the DOM after state change
      await waitFor(() => {
        const updatedForkLabel = screen.getByText('Fork');
        const updatedForkCard = updatedForkLabel.closest('.p-3');
        expect(updatedForkCard?.textContent).toContain('Tracking disabled');
      });
    });
  });

  describe('custom interval', () => {
    it('shows interval input when tracking is enabled and has override', () => {
      setupMockQueries();
      const bikePrefs = [
        { id: 'bp-1', componentType: 'FORK', trackingEnabled: true, customInterval: 40 },
      ];
      render(<BikeServicePreferencesEditor {...defaultProps} bikeServicePreferences={bikePrefs} />);

      const intervalInput = screen.getByDisplayValue('40');
      expect(intervalInput).toBeInTheDocument();
    });

    it('hides interval input when tracking is disabled', () => {
      setupMockQueries();
      const bikePrefs = [
        { id: 'bp-1', componentType: 'FORK', trackingEnabled: false, customInterval: null },
      ];
      render(<BikeServicePreferencesEditor {...defaultProps} bikeServicePreferences={bikePrefs} />);

      expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    });

    it('updates interval value on change', async () => {
      setupMockQueries();
      const bikePrefs = [
        { id: 'bp-1', componentType: 'FORK', trackingEnabled: true, customInterval: 40 },
      ];
      render(<BikeServicePreferencesEditor {...defaultProps} bikeServicePreferences={bikePrefs} />);

      const intervalInput = screen.getByDisplayValue('40');
      fireEvent.change(intervalInput, { target: { value: '55' } });

      await waitFor(() => {
        expect(screen.getByDisplayValue('55')).toBeInTheDocument();
      });
    });
  });

  describe('reset all to global', () => {
    it('shows reset button when there are overrides', () => {
      setupMockQueries();
      const bikePrefs = [
        { id: 'bp-1', componentType: 'FORK', trackingEnabled: false, customInterval: null },
      ];
      render(<BikeServicePreferencesEditor {...defaultProps} bikeServicePreferences={bikePrefs} />);

      expect(screen.getByText('Reset all to global defaults')).toBeInTheDocument();
    });

    it('hides reset button when no overrides exist', () => {
      setupMockQueries();
      render(<BikeServicePreferencesEditor {...defaultProps} />);

      expect(screen.queryByText('Reset all to global defaults')).not.toBeInTheDocument();
    });

    it('removes all overrides when clicking reset button', async () => {
      setupMockQueries();
      const bikePrefs = [
        { id: 'bp-1', componentType: 'FORK', trackingEnabled: false, customInterval: null },
        { id: 'bp-2', componentType: 'SHOCK', trackingEnabled: true, customInterval: 30 },
      ];
      render(<BikeServicePreferencesEditor {...defaultProps} bikeServicePreferences={bikePrefs} />);

      const resetButton = screen.getByText('Reset all to global defaults');
      fireEvent.click(resetButton);

      await waitFor(() => {
        // All components should now have "Override" buttons instead of "Use global"
        const overrideButtons = screen.getAllByText('Override');
        expect(overrideButtons.length).toBe(3);
      });
    });
  });

  describe('save functionality', () => {
    it('disables save button when no changes', () => {
      setupMockQueries();
      render(<BikeServicePreferencesEditor {...defaultProps} />);

      const saveButton = screen.getByRole('button', { name: 'Save Changes' });
      expect(saveButton).toBeDisabled();
    });

    it('enables save button when there are changes', async () => {
      setupMockQueries();
      render(<BikeServicePreferencesEditor {...defaultProps} />);

      // Create an override
      const overrideButtons = screen.getAllByText('Override');
      fireEvent.click(overrideButtons[0]);

      await waitFor(() => {
        const saveButton = screen.getByRole('button', { name: 'Save Changes' });
        expect(saveButton).not.toBeDisabled();
      });
    });

    it('calls mutation with only overridden preferences', async () => {
      setupMockQueries();
      render(<BikeServicePreferencesEditor {...defaultProps} />);

      // Create an override for Fork
      const overrideButtons = screen.getAllByText('Override');
      fireEvent.click(overrideButtons[0]);

      // Save
      const saveButton = screen.getByRole('button', { name: 'Save Changes' });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockUpdatePreferences).toHaveBeenCalledWith({
          variables: {
            input: {
              bikeId: 'bike-123',
              preferences: expect.arrayContaining([
                expect.objectContaining({
                  componentType: 'FORK',
                  trackingEnabled: true, // Inherited from global
                }),
              ]),
            },
          },
          refetchQueries: expect.anything(),
        });
      });
    });

    it('shows success message after save', async () => {
      setupMockQueries();
      render(<BikeServicePreferencesEditor {...defaultProps} />);

      // Create an override
      const overrideButtons = screen.getAllByText('Override');
      fireEvent.click(overrideButtons[0]);

      // Save
      const saveButton = screen.getByRole('button', { name: 'Save Changes' });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText('Saved!')).toBeInTheDocument();
      });
    });

    it('calls onSaved callback after successful save', async () => {
      setupMockQueries();
      const onSaved = vi.fn();
      render(<BikeServicePreferencesEditor {...defaultProps} onSaved={onSaved} />);

      // Create an override
      const overrideButtons = screen.getAllByText('Override');
      fireEvent.click(overrideButtons[0]);

      // Save
      const saveButton = screen.getByRole('button', { name: 'Save Changes' });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(onSaved).toHaveBeenCalled();
      });
    });

    it('shows error message on save failure', async () => {
      setupMockQueries();
      mockUpdatePreferences.mockRejectedValue(new Error('Network error'));

      render(<BikeServicePreferencesEditor {...defaultProps} />);

      // Create an override
      const overrideButtons = screen.getAllByText('Override');
      fireEvent.click(overrideButtons[0]);

      // Save
      const saveButton = screen.getByRole('button', { name: 'Save Changes' });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText('Failed to save preferences: Network error')).toBeInTheDocument();
      });
    });
  });

  describe('global preference display', () => {
    it('shows global tracking status for non-overridden components', () => {
      setupMockQueries();
      render(<BikeServicePreferencesEditor {...defaultProps} />);

      // Chain has trackingEnabled: false in global prefs
      // Navigate up to the card container to find all content
      const chainLabel = screen.getByText('Chain');
      const cardContainer = chainLabel.closest('.p-3');
      expect(cardContainer?.textContent).toContain('Tracking disabled');
    });

    it('shows global custom interval for non-overridden components', () => {
      setupMockQueries();
      render(<BikeServicePreferencesEditor {...defaultProps} />);

      // Fork has customInterval: 60 in global prefs
      const forkLabel = screen.getByText('Fork');
      const cardContainer = forkLabel.closest('.p-3');
      expect(cardContainer?.textContent).toContain('60h interval');
    });
  });

  describe('effective values', () => {
    it('uses bike override values when available', () => {
      setupMockQueries();
      const bikePrefs = [
        { id: 'bp-1', componentType: 'FORK', trackingEnabled: false, customInterval: 30 },
      ];
      render(<BikeServicePreferencesEditor {...defaultProps} bikeServicePreferences={bikePrefs} />);

      // Fork should show disabled tracking even though global has it enabled
      const forkLabel = screen.getByText('Fork');
      const cardContainer = forkLabel.closest('.p-3');
      expect(cardContainer?.textContent).toContain('Tracking disabled');
    });

    it('falls back to global values when no bike override', () => {
      setupMockQueries();
      render(<BikeServicePreferencesEditor {...defaultProps} />);

      // Fork should show enabled tracking from global
      const forkLabel = screen.getByText('Fork');
      const cardContainer = forkLabel.closest('.p-3');
      expect(cardContainer?.textContent).toContain('Tracking enabled');
    });
  });
});
