import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ComponentSharePanel } from './ComponentSharePanel';
import { localDayAfterIso, localDayStartIso } from '@/lib/componentShare';
import { todayDateInput } from '@/lib/format';

const mockCreate = vi.fn();
const mockRevoke = vi.fn();
const mockUseQuery = vi.fn();
vi.mock('@apollo/client', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: (doc: string) => [doc.includes('createComponentShare') ? mockCreate : mockRevoke, { loading: false }],
  gql: vi.fn((strings: TemplateStringsArray) => strings.join('')),
}));

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ isOpen, title, children }: { isOpen: boolean; title: string; children: React.ReactNode }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        {children}
      </div>
    ) : null,
}));

const writeText = vi.fn().mockResolvedValue(undefined);
Object.assign(navigator, { clipboard: { writeText } });

const created = {
  id: 'share-1',
  scope: 'LIFETIME',
  rangeStart: null,
  rangeEnd: null,
  url: 'https://loamlogger.app/share/component/abcdefghijkl',
  createdAt: '2026-10-08T12:00:00.000Z',
};

const renderPanel = () => {
  render(<ComponentSharePanel componentId="comp-1" installedAt="2025-09-15T16:00:00.000Z" />);
  fireEvent.click(screen.getByRole('button', { name: /Share/ }));
};

describe('ComponentSharePanel', () => {
  beforeEach(() => {
    mockCreate.mockReset().mockResolvedValue({ data: { createComponentShare: created } });
    mockRevoke.mockReset().mockResolvedValue({ data: { revokeComponentShare: true } });
    mockUseQuery.mockReset().mockReturnValue({ data: { component: { id: 'comp-1', shares: [] } } });
    writeText.mockClear();
  });

  it('creates a lifetime link and copies it', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Create and copy link/ }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(created.url));
    expect(mockCreate).toHaveBeenCalledWith({
      variables: { input: { componentId: 'comp-1', scope: 'LIFETIME' } },
    });
  });

  it('creates a since-service link with no dates', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('radio', { name: 'Since last service' }));
    fireEvent.click(screen.getByRole('button', { name: /Create and copy link/ }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockCreate.mock.calls[0][0].variables.input).toEqual({ componentId: 'comp-1', scope: 'SINCE_SERVICE' });
  });

  // No earlier than the install date, no later than today; the end day counts.
  it('bounds a range by the install date and today, and sends whole days', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('radio', { name: 'Date range' }));

    const from = screen.getByLabelText('From');
    const to = screen.getByLabelText('To');
    expect(from).toHaveAttribute('min', '2025-09-15');
    expect(to).toHaveAttribute('max', todayDateInput());

    fireEvent.change(from, { target: { value: '2026-01-01' } });
    fireEvent.change(to, { target: { value: '2026-01-31' } });
    fireEvent.click(screen.getByRole('button', { name: /Create and copy link/ }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(mockCreate.mock.calls[0][0].variables.input).toEqual({
      componentId: 'comp-1',
      scope: 'RANGE',
      rangeStart: localDayStartIso('2026-01-01'),
      rangeEnd: localDayAfterIso('2026-01-31'),
    });
  });

  it('will not create a range that starts before the install date', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('radio', { name: 'Date range' }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2025-08-01' } });

    expect(screen.getByRole('button', { name: /Create and copy link/ })).toBeDisabled();
  });

  it('lists existing links and revokes one', async () => {
    mockUseQuery.mockReturnValue({
      data: {
        component: {
          id: 'comp-1',
          shares: [
            { ...created, id: 'share-2', scope: 'RANGE', rangeStart: '2026-01-01T08:00:00.000Z', rangeEnd: '2026-02-01T08:00:00.000Z' },
          ],
        },
      },
    });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /Revoke the .* link/ }));
    await waitFor(() => expect(mockRevoke).toHaveBeenCalledWith({ variables: { id: 'share-2' } }));
  });

  it('says so when a link cannot be created', async () => {
    mockCreate.mockRejectedValue(new Error('A component can have at most 20 share links. Revoke one first.'));
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Create and copy link/ }));

    expect(await screen.findByText(/at most 20 share links/)).toBeInTheDocument();
  });
});
