import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UpdateAcquisitionModal } from './UpdateAcquisitionModal';

// Apollo mock — single shared mutation fn so tests can assert calls and
// swap resolved/rejected values per-test.
const mockUpdateAcquisition = vi.fn();
vi.mock('@apollo/client', () => ({
  useMutation: vi.fn(() => [mockUpdateAcquisition, { loading: false }]),
  gql: vi.fn((strings: TemplateStringsArray) => strings[0]),
}));

// Modal mock — pass-through that only renders when open. Keeps footer in
// the DOM so we can click Cancel / Update buttons.
vi.mock('../ui/Modal', () => ({
  Modal: ({
    isOpen,
    onClose,
    title,
    subtitle,
    children,
    footer,
  }: {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    subtitle?: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
    size?: string;
  }) =>
    isOpen ? (
      <div data-testid="modal">
        <h2>{title}</h2>
        {subtitle && <p data-testid="modal-subtitle">{subtitle}</p>}
        <button onClick={onClose} data-testid="modal-close">
          Close
        </button>
        {children}
        {footer && <div data-testid="modal-footer">{footer}</div>}
      </div>
    ) : null,
}));

vi.mock('../ui/Button', () => ({
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

// Stub query document imports — we only need the mutation to exist; the
// mocked useMutation doesn't care about the schema.
vi.mock('../../graphql/bike', () => ({ UPDATE_BIKE_ACQUISITION: 'UPDATE_BIKE_ACQUISITION' }));
vi.mock('../../graphql/bikes', () => ({ BIKES: 'BIKES' }));
vi.mock('../../graphql/gear', () => ({ GEAR_QUERY_LIGHT: 'GEAR_QUERY_LIGHT' }));
vi.mock('../../graphql/bikeHistory', () => ({ BIKE_HISTORY: 'BIKE_HISTORY' }));

describe('UpdateAcquisitionModal', () => {
  const baseProps = {
    bikeId: 'bike-1',
    bikeName: '2024 Slash',
    isOpen: true,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateAcquisition.mockResolvedValue({
      data: {
        updateBikeAcquisition: {
          installsMoved: 5,
          serviceLogsMoved: 5,
        },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('rendering', () => {
    it('does not render when closed', () => {
      render(<UpdateAcquisitionModal {...baseProps} isOpen={false} />);
      expect(screen.queryByTestId('modal')).not.toBeInTheDocument();
    });

    it('shows title and bike name subtitle', () => {
      render(<UpdateAcquisitionModal {...baseProps} />);
      expect(screen.getByText('Update acquisition date')).toBeInTheDocument();
      expect(screen.getByTestId('modal-subtitle')).toHaveTextContent('2024 Slash');
    });
  });

  describe('date seeding', () => {
    it("seeds the input with today's date when no current acquisition date", () => {
      // Freeze the clock for this one check so the seeded value is stable.
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-19T12:00:00'));
      try {
        render(<UpdateAcquisitionModal {...baseProps} currentAcquisitionDate={null} />);
        const input = screen.getByLabelText('Acquired on') as HTMLInputElement;
        expect(input.value).toBe('2026-04-19');
      } finally {
        vi.useRealTimers();
      }
    });

    it('seeds the input with the existing acquisition date when present', () => {
      render(
        <UpdateAcquisitionModal
          {...baseProps}
          currentAcquisitionDate="2021-05-10T12:00:00.000Z"
        />
      );
      const input = screen.getByLabelText('Acquired on') as HTMLInputElement;
      expect(input.value).toBe('2021-05-10');
    });
  });

  describe('cascade toggle', () => {
    it('defaults cascade to on', () => {
      render(<UpdateAcquisitionModal {...baseProps} />);
      const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
    });

    it('sends cascadeInstalls:false when the user unchecks the box', async () => {
      render(<UpdateAcquisitionModal {...baseProps} />);
      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(screen.getByText('Update'));
      await waitFor(() => {
        expect(mockUpdateAcquisition).toHaveBeenCalledWith(
          expect.objectContaining({
            variables: expect.objectContaining({
              input: expect.objectContaining({ cascadeInstalls: false }),
            }),
          })
        );
      });
    });

    it('sends cascadeInstalls:true by default', async () => {
      render(<UpdateAcquisitionModal {...baseProps} />);
      fireEvent.click(screen.getByText('Update'));
      await waitFor(() => {
        expect(mockUpdateAcquisition).toHaveBeenCalledWith(
          expect.objectContaining({
            variables: expect.objectContaining({
              input: expect.objectContaining({ cascadeInstalls: true }),
            }),
          })
        );
      });
    });
  });

  describe('submit', () => {
    it('serializes the date at noon local when submitting', async () => {
      render(<UpdateAcquisitionModal {...baseProps} />);
      fireEvent.change(screen.getByLabelText('Acquired on'), {
        target: { value: '2022-03-12' },
      });
      fireEvent.click(screen.getByText('Update'));
      await waitFor(() => {
        expect(mockUpdateAcquisition).toHaveBeenCalledWith(
          expect.objectContaining({
            variables: expect.objectContaining({
              bikeId: 'bike-1',
              input: expect.objectContaining({
                // Noon-anchored ISO — the exact UTC hour varies with the
                // test machine's timezone, so assert only the date + noon
                // pattern in local time via a regex on the serialized ISO.
                acquisitionDate: expect.stringMatching(/^2022-03-12T\d{2}:00:00\.000Z$/),
              }),
            }),
          })
        );
      });
    });

    it('shows "Pick a date" error when the date field is empty', async () => {
      render(<UpdateAcquisitionModal {...baseProps} />);
      fireEvent.change(screen.getByLabelText('Acquired on'), { target: { value: '' } });
      fireEvent.click(screen.getByText('Update'));
      expect(await screen.findByText('Pick a date.')).toBeInTheDocument();
      expect(mockUpdateAcquisition).not.toHaveBeenCalled();
    });
  });

  describe('success summary', () => {
    it('replaces the form with a summary showing installs moved', async () => {
      render(<UpdateAcquisitionModal {...baseProps} />);
      fireEvent.click(screen.getByText('Update'));
      await waitFor(() => {
        expect(screen.getByText(/install dates/)).toBeInTheDocument();
      });
      // Count is rendered as a standalone number; check it appears.
      expect(screen.getByText('5')).toBeInTheDocument();
      // Form controls should be gone.
      expect(screen.queryByLabelText('Acquired on')).not.toBeInTheDocument();
      // Footer swaps to "Done".
      expect(screen.getByText('Done')).toBeInTheDocument();
    });

    it('shows the baseline-anchors note when serviceLogsMoved > 0', async () => {
      render(<UpdateAcquisitionModal {...baseProps} />);
      fireEvent.click(screen.getByText('Update'));
      await waitFor(() => {
        expect(
          screen.getByText(/Baseline service anchors/)
        ).toBeInTheDocument();
      });
    });

    it('hides the baseline-anchors note when serviceLogsMoved is 0', async () => {
      mockUpdateAcquisition.mockResolvedValue({
        data: { updateBikeAcquisition: { installsMoved: 3, serviceLogsMoved: 0 } },
      });
      render(<UpdateAcquisitionModal {...baseProps} />);
      fireEvent.click(screen.getByText('Update'));
      await waitFor(() => {
        expect(screen.getByText(/install dates/)).toBeInTheDocument();
      });
      expect(screen.queryByText(/Baseline service anchors/)).not.toBeInTheDocument();
    });

    it('uses singular copy when installsMoved is 1', async () => {
      mockUpdateAcquisition.mockResolvedValue({
        data: { updateBikeAcquisition: { installsMoved: 1, serviceLogsMoved: 0 } },
      });
      render(<UpdateAcquisitionModal {...baseProps} />);
      fireEvent.click(screen.getByText('Update'));
      await waitFor(() => {
        // "install date" (singular, no trailing 's')
        expect(screen.getByText(/install date\s/)).toBeInTheDocument();
      });
    });

    it('calls onClose when Done is clicked', async () => {
      const onClose = vi.fn();
      render(<UpdateAcquisitionModal {...baseProps} onClose={onClose} />);
      fireEvent.click(screen.getByText('Update'));
      const doneBtn = await screen.findByText('Done');
      fireEvent.click(doneBtn);
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('error display', () => {
    it('shows the mutation error message inline on failure', async () => {
      mockUpdateAcquisition.mockRejectedValue(new Error('Rate limited'));
      render(<UpdateAcquisitionModal {...baseProps} />);
      fireEvent.click(screen.getByText('Update'));
      expect(await screen.findByText('Rate limited')).toBeInTheDocument();
      // Form stays on screen so the user can retry.
      expect(screen.getByLabelText('Acquired on')).toBeInTheDocument();
    });

    it('falls back to generic copy when error is not an Error', async () => {
      mockUpdateAcquisition.mockRejectedValue('boom');
      render(<UpdateAcquisitionModal {...baseProps} />);
      fireEvent.click(screen.getByText('Update'));
      expect(
        await screen.findByText('Failed to update acquisition date.')
      ).toBeInTheDocument();
    });
  });
});
