import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EditServiceModal } from './EditServiceModal';

const mockUpdateServiceLog = vi.fn();
vi.mock('@apollo/client', () => ({
  useMutation: vi.fn(() => [mockUpdateServiceLog, { loading: false }]),
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

const log = {
  id: 'log-1',
  performedAt: '2026-03-01T12:00:00.000Z',
  notes: 'old notes',
  hoursAtService: 42.123456789,
};

const renderModal = () =>
  render(<EditServiceModal log={log} componentLabel="Fork" bikeId="bike-1" onClose={vi.fn()} />);

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
