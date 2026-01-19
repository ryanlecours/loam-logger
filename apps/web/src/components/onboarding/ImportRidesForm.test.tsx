import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImportRidesForm } from './ImportRidesForm';

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock CSRF headers
vi.mock('@/lib/csrf', () => ({
  getAuthHeaders: () => ({ 'x-csrf-token': 'test-token' }),
}));

describe('ImportRidesForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: backfill history returns empty
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, requests: [] }),
    });
  });

  describe('Rendering', () => {
    it('renders nothing when no providers are connected', () => {
      const { container } = render(<ImportRidesForm connectedProviders={[]} />);
      expect(container.firstChild).toBeNull();
    });

    it('renders collapsed view initially', () => {
      render(<ImportRidesForm connectedProviders={['strava']} />);

      expect(screen.getByText('Import past rides')).toBeInTheDocument();
      expect(screen.getByText('Backfill component wear from your ride history')).toBeInTheDocument();
    });

    it('expands when header is clicked', () => {
      render(<ImportRidesForm connectedProviders={['strava']} />);

      fireEvent.click(screen.getByRole('button', { name: /Import past rides/i }));

      expect(screen.getByText('Year to import')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Start Import/i })).toBeInTheDocument();
    });
  });

  describe('Provider Selection', () => {
    it('auto-selects provider when only one is connected', () => {
      render(<ImportRidesForm connectedProviders={['strava']} />);

      fireEvent.click(screen.getByRole('button', { name: /Import past rides/i }));

      expect(screen.getByText(/Importing from/)).toBeInTheDocument();
      expect(screen.getByText('Strava')).toBeInTheDocument();
    });

    it('shows provider selector when multiple providers connected', () => {
      render(<ImportRidesForm connectedProviders={['strava', 'garmin']} />);

      fireEvent.click(screen.getByRole('button', { name: /Import past rides/i }));

      expect(screen.getByText('Import from')).toBeInTheDocument();
      expect(screen.getByText('Strava')).toBeInTheDocument();
      expect(screen.getByText('Garmin Connect')).toBeInTheDocument();
    });

    it('allows selecting a provider', () => {
      render(<ImportRidesForm connectedProviders={['strava', 'garmin']} />);

      fireEvent.click(screen.getByRole('button', { name: /Import past rides/i }));

      const stravaRadio = screen.getByRole('radio', { name: /Strava/i });
      fireEvent.click(stravaRadio);

      expect(stravaRadio).toBeChecked();
    });
  });

  describe('Year Selection', () => {
    it('defaults to YTD', () => {
      render(<ImportRidesForm connectedProviders={['strava']} />);

      fireEvent.click(screen.getByRole('button', { name: /Import past rides/i }));

      const select = screen.getByRole('combobox');
      expect(select).toHaveValue('ytd');
    });

    it('shows year options including YTD and previous years', () => {
      render(<ImportRidesForm connectedProviders={['strava']} />);

      fireEvent.click(screen.getByRole('button', { name: /Import past rides/i }));

      const select = screen.getByRole('combobox');
      const options = select.querySelectorAll('option');

      // YTD + 5 previous years = 6 options (current year removed as redundant with YTD)
      expect(options.length).toBe(6);
      expect(options[0]).toHaveTextContent('Year to Date');
    });

    it('allows selecting a different year', () => {
      render(<ImportRidesForm connectedProviders={['strava']} />);

      fireEvent.click(screen.getByRole('button', { name: /Import past rides/i }));

      const select = screen.getByRole('combobox');
      const lastYear = new Date().getFullYear() - 1;
      fireEvent.change(select, { target: { value: String(lastYear) } });

      expect(select).toHaveValue(String(lastYear));
    });
  });

  describe('Bike Assignment Notes', () => {
    it('shows Garmin-specific note when Garmin is selected', () => {
      render(<ImportRidesForm connectedProviders={['garmin']} />);

      fireEvent.click(screen.getByRole('button', { name: /Import past rides/i }));

      expect(screen.getByText(/If you rode multiple bikes/)).toBeInTheDocument();
      expect(screen.getByText(/you'll need to assign the correct bike/)).toBeInTheDocument();
    });

    it('shows Strava-specific note when Strava is selected', () => {
      render(<ImportRidesForm connectedProviders={['strava']} />);

      fireEvent.click(screen.getByRole('button', { name: /Import past rides/i }));

      expect(screen.getByText(/You'll be prompted to map your Strava gear/)).toBeInTheDocument();
    });
  });

  describe('Backfill History', () => {
    it('shows loading state while fetching history', async () => {
      // Delay the fetch response
      mockFetch.mockImplementation(() =>
        new Promise((resolve) =>
          setTimeout(() => resolve({
            ok: true,
            json: () => Promise.resolve({ success: true, requests: [] }),
          }), 100)
        )
      );

      render(<ImportRidesForm connectedProviders={['garmin']} />);

      fireEvent.click(screen.getByRole('button', { name: /Import past rides/i }));

      // Should show loading state
      expect(screen.getByText('Loading history...')).toBeInTheDocument();
    });

    it('displays backfill history pills after loading', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          requests: [
            { id: '1', provider: 'garmin', year: '2024', status: 'completed', ridesFound: 50 },
            { id: '2', provider: 'garmin', year: 'ytd', status: 'in_progress', ridesFound: null },
          ],
        }),
      });

      render(<ImportRidesForm connectedProviders={['garmin']} />);

      fireEvent.click(screen.getByRole('button', { name: /Import past rides/i }));

      await waitFor(() => {
        // Check for the "Previously requested" section which contains history pills
        expect(screen.getByText('Previously requested')).toBeInTheDocument();
        // Use getAllByText since there are now multiple "2024" elements (checkbox label + history pill)
        const elements2024 = screen.getAllByText('2024');
        expect(elements2024.length).toBeGreaterThanOrEqual(2); // checkbox label + pill
        // YTD appears in checkbox label and as history pill
        const ytdElements = screen.getAllByText('YTD');
        expect(ytdElements.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('shows checkmark for completed years (Garmin)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          requests: [
            { id: '1', provider: 'garmin', year: '2024', status: 'completed', ridesFound: 50 },
          ],
        }),
      });

      render(<ImportRidesForm connectedProviders={['garmin']} />);

      fireEvent.click(screen.getByRole('button', { name: /Import past rides/i }));

      await waitFor(() => {
        // Garmin uses checkboxes - completed year checkbox should be disabled
        const checkbox2024 = screen.getByRole('checkbox', { name: /2024/i });
        expect(checkbox2024).toBeDisabled();
      });
    });
  });

  describe('Duplicate Prevention (Garmin)', () => {
    it('disables checkbox for already backfilled year', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          requests: [
            { id: '1', provider: 'garmin', year: '2024', status: 'completed', ridesFound: 50 },
          ],
        }),
      });

      render(<ImportRidesForm connectedProviders={['garmin']} />);

      fireEvent.click(screen.getByRole('button', { name: /Import past rides/i }));

      await waitFor(() => {
        // Garmin uses checkboxes - completed year checkbox should be disabled
        const checkbox2024 = screen.getByRole('checkbox', { name: /2024/i });
        expect(checkbox2024).toBeDisabled();
      });
    });

    it('allows YTD even if previously backfilled (incremental)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          requests: [
            { id: '1', provider: 'garmin', year: 'ytd', status: 'completed', ridesFound: 50 },
          ],
        }),
      });

      render(<ImportRidesForm connectedProviders={['garmin']} />);

      fireEvent.click(screen.getByRole('button', { name: /Import past rides/i }));

      await waitFor(() => {
        // YTD checkbox should be enabled even after previous backfill (incremental)
        const ytdCheckbox = screen.getByRole('checkbox', { name: /Year to Date/i });
        expect(ytdCheckbox).not.toBeDisabled();
      });
    });

    it('disables YTD checkbox when already in progress', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          requests: [
            { id: '1', provider: 'garmin', year: 'ytd', status: 'in_progress', ridesFound: null },
          ],
        }),
      });

      render(<ImportRidesForm connectedProviders={['garmin']} />);

      fireEvent.click(screen.getByRole('button', { name: /Import past rides/i }));

      await waitFor(() => {
        // YTD checkbox should be disabled when in progress
        const ytdCheckbox = screen.getByRole('checkbox', { name: /Year to Date/i });
        expect(ytdCheckbox).toBeDisabled();
      });
    });

    it('allows retry for failed backfills', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          success: true,
          requests: [
            { id: '1', provider: 'garmin', year: '2024', status: 'failed', ridesFound: null },
          ],
        }),
      });

      render(<ImportRidesForm connectedProviders={['garmin']} />);

      fireEvent.click(screen.getByRole('button', { name: /Import past rides/i }));

      await waitFor(() => {
        // Failed year checkbox should be enabled for retry
        const checkbox2024 = screen.getByRole('checkbox', { name: /2024/i });
        expect(checkbox2024).not.toBeDisabled();
      });
    });
  });

  describe('Import Flow', () => {
    it('disables import button when no provider selected (multiple providers)', async () => {
      render(<ImportRidesForm connectedProviders={['strava', 'garmin']} />);

      fireEvent.click(screen.getByRole('button', { name: /Import past rides/i }));

      const importButton = screen.getByRole('button', { name: /Start Import/i });
      expect(importButton).toBeDisabled();
    });

    it('shows loading state during import', async () => {
      // Delay the import response
      let resolveImport: (value: Response) => void;
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, requests: [] }),
        })
        .mockImplementationOnce(() =>
          new Promise((resolve) => {
            resolveImport = resolve;
          })
        );

      render(<ImportRidesForm connectedProviders={['strava']} />);

      fireEvent.click(screen.getByRole('button', { name: /Import past rides/i }));

      await waitFor(() => {
        expect(screen.queryByText('Loading history...')).not.toBeInTheDocument();
      });

      const importButton = screen.getByRole('button', { name: /Start Import/i });
      fireEvent.click(importButton);

      await waitFor(() => {
        expect(screen.getByText('Importing...')).toBeInTheDocument();
      });

      // Resolve the import
      resolveImport!({
        ok: true,
        json: () => Promise.resolve({ success: true, imported: 10 }),
      } as Response);
    });

    it('shows success message after Strava import', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, requests: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, imported: 25, duplicates: 5 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, requests: [] }),
        });

      render(<ImportRidesForm connectedProviders={['strava']} />);

      fireEvent.click(screen.getByRole('button', { name: /Import past rides/i }));

      await waitFor(() => {
        expect(screen.queryByText('Loading history...')).not.toBeInTheDocument();
      });

      const importButton = screen.getByRole('button', { name: /Start Import/i });
      fireEvent.click(importButton);

      await waitFor(() => {
        expect(screen.getByText(/25 rides imported/)).toBeInTheDocument();
        expect(screen.getByText(/5 already existed/)).toBeInTheDocument();
      });
    });

    it('shows async message after Garmin import', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, requests: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            message: 'Backfill triggered. Your rides will sync automatically via webhooks.',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, requests: [] }),
        });

      render(<ImportRidesForm connectedProviders={['garmin']} />);

      fireEvent.click(screen.getByRole('button', { name: /Import past rides/i }));

      await waitFor(() => {
        expect(screen.queryByText('Loading history...')).not.toBeInTheDocument();
      });

      const importButton = screen.getByRole('button', { name: /Start Import/i });
      fireEvent.click(importButton);

      await waitFor(() => {
        expect(screen.getByText(/Import started - rides will sync shortly/)).toBeInTheDocument();
      });
    });

    it('handles 409 conflict error', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, requests: [] }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 409,
          json: () => Promise.resolve({
            error: 'Backfill already in progress',
            message: 'A backfill for this time period is already in progress.',
          }),
        });

      render(<ImportRidesForm connectedProviders={['garmin']} />);

      fireEvent.click(screen.getByRole('button', { name: /Import past rides/i }));

      await waitFor(() => {
        expect(screen.queryByText('Loading history...')).not.toBeInTheDocument();
      });

      const importButton = screen.getByRole('button', { name: /Start Import/i });
      fireEvent.click(importButton);

      await waitFor(() => {
        expect(screen.getByText(/A backfill for this time period is already in progress/)).toBeInTheDocument();
      });
    });

    it('handles generic error', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, requests: [] }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: 'Server error' }),
        });

      render(<ImportRidesForm connectedProviders={['garmin']} />);

      fireEvent.click(screen.getByRole('button', { name: /Import past rides/i }));

      await waitFor(() => {
        expect(screen.queryByText('Loading history...')).not.toBeInTheDocument();
      });

      const importButton = screen.getByRole('button', { name: /Start Import/i });
      fireEvent.click(importButton);

      await waitFor(() => {
        expect(screen.getByText(/Server error/)).toBeInTheDocument();
      });
    });
  });
});
