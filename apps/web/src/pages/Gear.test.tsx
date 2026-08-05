import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import Gear from './Gear';

const mockNavigate = vi.fn();
const mockUseUserTier = vi.fn();
const mockMutation = vi.fn();

vi.mock('@apollo/client', () => ({
  gql: (strings: TemplateStringsArray) => strings.join(''),
  useQuery: () => ({
    data: { bikes: [], spareComponents: [] },
    loading: false,
    error: undefined,
  }),
  useMutation: () => [mockMutation, { loading: false }],
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/hooks/useUserTier', () => ({
  useUserTier: () => mockUseUserTier(),
}));

vi.mock('@/components/gear', () => ({
  GearPageHeader: ({ onAddBike, onAddSpare }: { onAddBike: () => void; onAddSpare: () => void }) => (
    <div>
      <button onClick={onAddBike}>Add Bike</button>
      <button onClick={onAddSpare}>Add Spare</button>
    </div>
  ),
  BikeOverviewCard: () => null,
  SpareComponentsPanel: () => null,
}));

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ isOpen, title, children }: { isOpen: boolean; title: string; children?: React.ReactNode }) =>
    isOpen ? <div role="dialog" aria-label={title}>{children}</div> : null,
}));

vi.mock('@/components/BikeForm', () => ({
  BikeForm: () => <div data-testid="bike-form" />,
}));

vi.mock('@/components/SpareComponentForm', () => ({
  SpareComponentForm: () => null,
}));

vi.mock('@/components/dashboard', () => ({
  LogServiceModal: () => null,
}));

vi.mock('@/utils/toastHelpers', () => ({
  showBikeCreatedToast: vi.fn(),
}));

const renderGear = () =>
  render(
    <MemoryRouter>
      <Gear />
    </MemoryRouter>
  );

describe('Gear bike-limit gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockUseUserTier.mockReturnValue({ canAddBike: true });
  });

  it('opens the Add Bike form when under the bike limit', () => {
    renderGear();
    fireEvent.click(screen.getByRole('button', { name: 'Add Bike' }));

    expect(screen.getByRole('dialog', { name: 'Add Bike' })).toBeInTheDocument();
    expect(screen.queryByText('N+1, meet Pro.')).not.toBeInTheDocument();
  });

  it('shows the bike-limit upsell instead of the form when at the limit', () => {
    mockUseUserTier.mockReturnValue({ canAddBike: false });
    renderGear();
    fireEvent.click(screen.getByRole('button', { name: 'Add Bike' }));

    expect(screen.getByText('N+1, meet Pro.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('re-shows the upsell on every attempt even after dismissal', () => {
    mockUseUserTier.mockReturnValue({ canAddBike: false });
    renderGear();

    fireEvent.click(screen.getByRole('button', { name: 'Add Bike' }));
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText('N+1, meet Pro.')).not.toBeInTheDocument();

    // The card is click-triggered, so dismissal must be session-only: a
    // persisted dismissal would leave the Add Bike button doing nothing.
    fireEvent.click(screen.getByRole('button', { name: 'Add Bike' }));
    expect(screen.getByText('N+1, meet Pro.')).toBeInTheDocument();
  });
});
