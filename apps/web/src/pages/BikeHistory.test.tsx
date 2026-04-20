import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BikeHistory from './BikeHistory';

// Apollo — useQuery returns the fixed fixture below; useMutation returns
// a shared mock fn so each test can assert the bulk-update payload.
const mockBulkUpdate = vi.fn();
const mockUseQuery = vi.fn();
vi.mock('@apollo/client', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: vi.fn(() => [mockBulkUpdate, { loading: false }]),
  gql: vi.fn((strings: TemplateStringsArray) => strings[0]),
}));

// Pin the bikeId so the query fixture is reachable.
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom'
  );
  return {
    ...actual,
    useParams: () => ({ bikeId: 'bike-1' }),
  };
});

// Modal + Button pass-throughs.
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({
    isOpen,
    onClose,
    title,
    children,
    footer,
  }: {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) =>
    isOpen ? (
      <div data-testid="modal" aria-label={title}>
        <h2>{title}</h2>
        <button onClick={onClose} data-testid="modal-close">
          Close
        </button>
        {children}
        {footer && <div data-testid="modal-footer">{footer}</div>}
      </div>
    ) : null,
}));

vi.mock('@/components/ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    variant,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: string;
    size?: string;
  }) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant}>
      {children}
    </button>
  ),
}));

// Child modals — stubbed out; these tests don't care about their internals.
vi.mock('@/components/dashboard/EditServiceModal', () => ({
  EditServiceModal: () => <div data-testid="edit-service-modal" />,
}));
vi.mock('@/components/dashboard/EditInstallModal', () => ({
  EditInstallModal: () => <div data-testid="edit-install-modal" />,
}));

// Lazy PDF button — the real module is lazy-loaded via Suspense.
vi.mock('@/components/history/BikeHistoryPdfButton', () => ({
  default: () => <button data-testid="pdf-btn">PDF</button>,
}));

vi.mock('@/hooks/usePreferences', () => ({
  usePreferences: () => ({ distanceUnit: 'mi' }),
}));

vi.mock('@/constants/componentLabels', () => ({
  getComponentLabel: (type: string) => type,
}));

vi.mock('@/graphql/bikeHistory', () => ({ BIKE_HISTORY: 'BIKE_HISTORY' }));
vi.mock('@/graphql/bike', () => ({
  BULK_UPDATE_BIKE_COMPONENT_INSTALLS: 'BULK_UPDATE_BIKE_COMPONENT_INSTALLS',
}));

// Fixture: one INSTALLED, one REMOVED, one paired INSTALLED/REMOVED set.
// Base ids strip the ":installed" / ":removed" suffix, matching the
// production id convention the backend resolver emits.
const fixture = {
  bikeHistory: {
    bike: {
      id: 'bike-1',
      manufacturer: 'Santa Cruz',
      model: 'Bronson',
      year: 2024,
      nickname: null,
    },
    totals: {
      rideCount: 0,
      totalDistanceMeters: 0,
      totalDurationSeconds: 0,
      totalElevationGainMeters: 0,
      serviceEventCount: 0,
      installEventCount: 3,
    },
    truncated: false,
    rides: [],
    serviceEvents: [],
    installs: [
      {
        id: 'inst-A:installed',
        eventType: 'INSTALLED',
        occurredAt: '2024-06-01T12:00:00.000Z',
        component: {
          id: 'c-A',
          type: 'TIRE',
          location: 'FRONT',
          brand: 'Maxxis',
          model: 'DHF',
        },
      },
      {
        id: 'inst-B:installed',
        eventType: 'INSTALLED',
        occurredAt: '2024-06-02T12:00:00.000Z',
        component: {
          id: 'c-B',
          type: 'TIRE',
          location: 'REAR',
          brand: 'Maxxis',
          model: 'DHR',
        },
      },
      {
        id: 'inst-B:removed',
        eventType: 'REMOVED',
        occurredAt: '2024-07-01T12:00:00.000Z',
        component: {
          id: 'c-B',
          type: 'TIRE',
          location: 'REAR',
          brand: 'Maxxis',
          model: 'DHR',
        },
      },
    ],
  },
};

function renderPage() {
  return render(
    <MemoryRouter>
      <BikeHistory />
    </MemoryRouter>
  );
}

// Scope queries to the bottom action bar so TotalChip counts ("0 rides",
// "3 service events") don't collide with "N selected" text.
function actionBar() {
  const setDateBtn = screen.queryByText('Set date');
  const bar = setDateBtn?.closest('div.fixed') as HTMLElement | null;
  if (!bar) throw new Error('Action bar not in DOM');
  return within(bar);
}

describe('BikeHistory multi-select', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQuery.mockReturnValue({ data: fixture, loading: false, error: undefined });
    mockBulkUpdate.mockResolvedValue({
      data: {
        bulkUpdateBikeComponentInstalls: { updatedCount: 2, serviceLogsMoved: 2 },
      },
    });
  });

  const enterSelectionMode = () => {
    fireEvent.click(screen.getByText('Edit dates'));
  };

  describe('entering and exiting selection mode', () => {
    it('shows "Edit dates" button by default, no action bar', () => {
      renderPage();
      expect(screen.getByText('Edit dates')).toBeInTheDocument();
      expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
    });

    it('enters selection mode — action bar appears with zero count and hint', () => {
      renderPage();
      enterSelectionMode();
      const bar = actionBar();
      expect(bar.getByText('0')).toBeInTheDocument();
      expect(bar.getByText(/tap install events to select/)).toBeInTheDocument();
      expect(bar.getByText('Set date')).toBeDisabled();
    });

    it('swaps the "Edit dates" button for "Cancel" in the header', () => {
      renderPage();
      enterSelectionMode();
      expect(screen.queryByText('Edit dates')).not.toBeInTheDocument();
      // Two Cancel buttons now: header + bottom action bar. Both exit mode.
      const cancels = screen.getAllByText('Cancel');
      expect(cancels.length).toBeGreaterThanOrEqual(1);
    });

    it('Cancel in the header exits selection mode and clears selections', () => {
      renderPage();
      enterSelectionMode();
      fireEvent.click(
        screen.getByLabelText(/Edit installed event for TIRE \(front\)/)
      );
      // Header cancel is the first Cancel in the DOM.
      fireEvent.click(screen.getAllByText('Cancel')[0]);
      // Action bar gone → no "selected" text.
      expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
      // Re-entering shows count back at 0.
      enterSelectionMode();
      expect(actionBar().getByText('0')).toBeInTheDocument();
    });
  });

  describe('row selectability', () => {
    it('INSTALLED rows toggle selection on tap; count updates', () => {
      renderPage();
      enterSelectionMode();
      const rowA = screen.getByLabelText(/Edit installed event for TIRE \(front\)/);
      fireEvent.click(rowA);
      expect(actionBar().getByText('1')).toBeInTheDocument();
      // Hint copy goes away once the count is non-zero.
      expect(
        screen.queryByText(/tap install events to select/)
      ).not.toBeInTheDocument();
      expect(actionBar().getByText('Set date')).not.toBeDisabled();
      // Tap again → deselect.
      fireEvent.click(rowA);
      expect(actionBar().getByText('0')).toBeInTheDocument();
      expect(actionBar().getByText('Set date')).toBeDisabled();
    });

    it('REMOVED rows do not toggle selection', () => {
      renderPage();
      enterSelectionMode();
      const removedRow = screen.getByLabelText(/Edit removed event for TIRE \(rear\)/);
      fireEvent.click(removedRow);
      expect(actionBar().getByText('0')).toBeInTheDocument();
      expect(actionBar().getByText('Set date')).toBeDisabled();
    });

    it('selecting multiple INSTALLED rows accumulates the count', () => {
      renderPage();
      enterSelectionMode();
      fireEvent.click(
        screen.getByLabelText(/Edit installed event for TIRE \(front\)/)
      );
      fireEvent.click(
        screen.getByLabelText(/Edit installed event for TIRE \(rear\)/)
      );
      expect(actionBar().getByText('2')).toBeInTheDocument();
    });
  });

  describe('Set date → BulkDateModal flow', () => {
    it('opens the modal when Set date is clicked', () => {
      renderPage();
      enterSelectionMode();
      fireEvent.click(
        screen.getByLabelText(/Edit installed event for TIRE \(front\)/)
      );
      fireEvent.click(actionBar().getByText('Set date'));
      expect(
        screen.getByRole('heading', { name: /Set date for 1 install$/ })
      ).toBeInTheDocument();
    });

    it('pluralizes the modal title when multiple installs are selected', () => {
      renderPage();
      enterSelectionMode();
      fireEvent.click(
        screen.getByLabelText(/Edit installed event for TIRE \(front\)/)
      );
      fireEvent.click(
        screen.getByLabelText(/Edit installed event for TIRE \(rear\)/)
      );
      fireEvent.click(actionBar().getByText('Set date'));
      expect(
        screen.getByRole('heading', { name: /Set date for 2 installs$/ })
      ).toBeInTheDocument();
    });

    it('Apply submits the selected ids with noon-anchored iso and exits mode', async () => {
      renderPage();
      enterSelectionMode();
      fireEvent.click(
        screen.getByLabelText(/Edit installed event for TIRE \(front\)/)
      );
      fireEvent.click(
        screen.getByLabelText(/Edit installed event for TIRE \(rear\)/)
      );
      fireEvent.click(actionBar().getByText('Set date'));

      const modal = screen.getByTestId('modal');
      const dateInput = within(modal).getByDisplayValue(
        /\d{4}-\d{2}-\d{2}/
      ) as HTMLInputElement;
      fireEvent.change(dateInput, { target: { value: '2022-05-10' } });

      fireEvent.click(within(modal).getByText('Apply'));

      await waitFor(() => {
        expect(mockBulkUpdate).toHaveBeenCalledTimes(1);
      });
      expect(mockBulkUpdate).toHaveBeenCalledWith({
        variables: {
          input: {
            // Order isn't guaranteed because Set iteration order matches
            // insertion order, but both clicks are present.
            ids: expect.arrayContaining(['inst-A', 'inst-B']),
            installedAt: expect.stringMatching(/^2022-05-10T\d{2}:00:00\.000Z$/),
          },
        },
      });
      // After success: selection mode exited, action bar gone.
      await waitFor(() => {
        expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
      });
      expect(screen.getByText('Edit dates')).toBeInTheDocument();
    });

    it('sends only the base ids (":installed" suffix stripped)', async () => {
      renderPage();
      enterSelectionMode();
      fireEvent.click(
        screen.getByLabelText(/Edit installed event for TIRE \(front\)/)
      );
      fireEvent.click(actionBar().getByText('Set date'));
      fireEvent.click(
        within(screen.getByTestId('modal')).getByText('Apply')
      );
      await waitFor(() => {
        expect(mockBulkUpdate).toHaveBeenCalled();
      });
      const call = mockBulkUpdate.mock.calls[0][0];
      expect(call.variables.input.ids).toEqual(['inst-A']);
    });
  });

  describe('handleBulkSetDate error path', () => {
    it('shows the mutation error inline and keeps selection mode active', async () => {
      mockBulkUpdate.mockRejectedValue(new Error('Removal date conflict'));
      renderPage();
      enterSelectionMode();
      fireEvent.click(
        screen.getByLabelText(/Edit installed event for TIRE \(front\)/)
      );
      fireEvent.click(actionBar().getByText('Set date'));
      fireEvent.click(
        within(screen.getByTestId('modal')).getByText('Apply')
      );

      expect(await screen.findByText('Removal date conflict')).toBeInTheDocument();
      // Selection preserved so the user can retry without re-picking rows.
      expect(actionBar().getByText('1')).toBeInTheDocument();
      // Bulk modal still open.
      expect(screen.getByTestId('modal')).toBeInTheDocument();
    });

    it('falls back to generic copy when the thrown value is not an Error', async () => {
      mockBulkUpdate.mockRejectedValue('unknown');
      renderPage();
      enterSelectionMode();
      fireEvent.click(
        screen.getByLabelText(/Edit installed event for TIRE \(front\)/)
      );
      fireEvent.click(actionBar().getByText('Set date'));
      fireEvent.click(
        within(screen.getByTestId('modal')).getByText('Apply')
      );
      expect(
        await screen.findByText('Failed to update install dates.')
      ).toBeInTheDocument();
    });
  });
});
