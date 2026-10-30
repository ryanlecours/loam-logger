import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EditServiceModal, type EditableServiceLog } from './EditServiceModal';

const mockUpdateServiceLog = vi.fn();
vi.mock('@apollo/client', () => ({
  useMutation: vi.fn(() => [mockUpdateServiceLog, { loading: false }]),
  // The rider's currency comes off the cached `me` query; none set here, so
  // the modal falls back to USD.
  useQuery: () => ({ data: { me: { currency: null } }, loading: false }),
  gql: vi.fn((strings: TemplateStringsArray) => strings[0]),
}));

vi.mock('../ui/Modal', () => ({
  Modal: ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
}));

vi.mock('../ui/Button', () => ({
  Button: ({ children, onClick, disabled }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

const log: EditableServiceLog = {
  id: 'log-1',
  performedAt: '2026-03-01T12:00:00.000Z',
  notes: 'old notes',
  hoursAtService: 42.123456789,
  costMinor: null,
  currency: null,
  parts: [],
};

const renderModal = (overrides: Partial<typeof log> = {}) =>
  render(
    <EditServiceModal
      log={{ ...log, ...overrides }}
      componentLabel="Fork"
      bikeId="bike-1"
      component={{ brand: 'Fox', model: '36 Factory' }}
      onClose={vi.fn()}
    />
  );

const savedInput = () => mockUpdateServiceLog.mock.calls[0][0].variables.input;

// The server treats any hoursAtService it receives as the rider's declared
// reading, which stops following ride history. A date or notes edit must not
// send the prefilled reading back.
describe('EditServiceModal', () => {
  beforeEach(() => {
    mockUpdateServiceLog.mockReset().mockResolvedValue({});
  });

  it('leaves the hours out when only the notes change', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'new pads' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(mockUpdateServiceLog).toHaveBeenCalled());
    expect(savedInput()).toMatchObject({ notes: 'new pads' });
    expect(savedInput()).not.toHaveProperty('hoursAtService');
  });

  it('leaves the hours out when only the date changes', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText('Service date'), { target: { value: '2026-02-20' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(mockUpdateServiceLog).toHaveBeenCalled());
    expect(savedInput()).not.toHaveProperty('hoursAtService');
  });

  it('sends the hours when the rider edits them', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText('Hours at service'), { target: { value: '300' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(mockUpdateServiceLog).toHaveBeenCalled());
    expect(savedInput()).toMatchObject({ hoursAtService: 300 });
  });
});

// Cost and parts are sent only when they changed: parts are replace-all on
// the server, and a null cost clears it, so an untouched section must stay
// out of the input entirely.
describe('EditServiceModal parts and cost', () => {
  beforeEach(() => {
    mockUpdateServiceLog.mockReset().mockResolvedValue({});
  });

  const openDetails = () => fireEvent.click(screen.getByRole('button', { name: /Parts and cost/ }));

  it('leaves cost and parts out when the section is untouched', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'new pads' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(mockUpdateServiceLog).toHaveBeenCalled());
    expect(savedInput()).not.toHaveProperty('costMinor');
    expect(savedInput()).not.toHaveProperty('parts');
    expect(savedInput()).not.toHaveProperty('currency');
  });

  it('starts collapsed on a log with nothing recorded and open on one with a cost', () => {
    const { unmount } = renderModal();
    expect(screen.getByRole('button', { name: /Parts and cost/ })).toHaveAttribute('aria-expanded', 'false');
    unmount();

    renderModal({ costMinor: 8500, currency: 'USD' });
    expect(screen.getByRole('button', { name: /Parts and cost/ })).toHaveAttribute('aria-expanded', 'true');
    expect((screen.getByLabelText('Cost') as HTMLInputElement).value).toBe('85.00');
  });

  it('sends the cost and currency when the rider enters one', async () => {
    renderModal();
    openDetails();
    fireEvent.change(screen.getByLabelText('Cost'), { target: { value: '85' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(mockUpdateServiceLog).toHaveBeenCalled());
    expect(savedInput()).toMatchObject({ costMinor: 8500, currency: 'USD' });
    expect(savedInput()).not.toHaveProperty('parts');
  });

  it('sends null to clear a cost the rider blanks out', async () => {
    renderModal({ costMinor: 8500, currency: 'USD' });
    fireEvent.change(screen.getByLabelText('Cost'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(mockUpdateServiceLog).toHaveBeenCalled());
    expect(savedInput()).toMatchObject({ costMinor: null, currency: 'USD' });
  });

  it('sends the whole parts list when a part changes', async () => {
    renderModal({
      parts: [{ id: 'p1', brand: 'Fox', model: 'Seal kit', priceMinor: 3850, vendor: null }],
    });
    // Already open: the log has parts.
    fireEvent.click(screen.getByText('Add part'));
    fireEvent.change(screen.getByLabelText('Part 2 model'), { target: { value: '20wt oil' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(mockUpdateServiceLog).toHaveBeenCalled());
    expect(savedInput()).toMatchObject({
      parts: [
        { brand: 'Fox', model: 'Seal kit', priceMinor: 3850 },
        { brand: '', model: '20wt oil' },
      ],
      currency: 'USD',
    });
    // The parts' prices now sum to a total the log did not have before.
    expect(savedInput()).toMatchObject({ costMinor: 3850 });
  });

  it('sends an empty list when the last part is removed', async () => {
    renderModal({
      parts: [{ id: 'p1', brand: 'Fox', model: 'Seal kit', priceMinor: null, vendor: null }],
    });
    fireEvent.click(screen.getByLabelText('Remove part 1'));
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(mockUpdateServiceLog).toHaveBeenCalled());
    expect(savedInput()).toMatchObject({ parts: [] });
  });
});
