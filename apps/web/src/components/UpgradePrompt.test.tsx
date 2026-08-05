import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ProChip, UpsellCard } from './UpgradePrompt';
import { UPSELL_COPY } from '../constants/upsellCopy';

const mockNavigate = vi.fn();

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const DISMISS_KEY = UPSELL_COPY.predictions.dismissKey;

// The global test setup replaces localStorage with bare vi.fn() mocks; these
// tests exercise real persistence semantics, so back the mocks with a Map.
const store = new Map<string, string>();
const installStorage = () => {
  vi.mocked(window.localStorage.getItem).mockImplementation((k: string) =>
    store.has(k) ? store.get(k)! : null
  );
  vi.mocked(window.localStorage.setItem).mockImplementation((k: string, v: string) => {
    store.set(k, String(v));
  });
};

const renderCard = (props: Partial<React.ComponentProps<typeof UpsellCard>> = {}) =>
  render(
    <MemoryRouter>
      <UpsellCard feature="predictions" {...props} />
    </MemoryRouter>
  );

describe('ProChip', () => {
  beforeEach(() => vi.clearAllMocks());

  it('navigates to /pricing with the given source', () => {
    render(
      <MemoryRouter>
        <ProChip source="dashboard-health-row" />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: /included with pro/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/pricing?source=dashboard-health-row');
  });
});

describe('UpsellCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    installStorage();
  });

  it('renders the copy-map title and body', () => {
    renderCard();
    expect(screen.getByText(UPSELL_COPY.predictions.title)).toBeInTheDocument();
    expect(screen.getByText(UPSELL_COPY.predictions.body)).toBeInTheDocument();
  });

  it('prefers the body override when provided', () => {
    renderCard({ body: 'One part is past its service interval.' });
    expect(screen.getByText('One part is past its service interval.')).toBeInTheDocument();
    expect(screen.queryByText(UPSELL_COPY.predictions.body)).not.toBeInTheDocument();
  });

  it('routes to /pricing with an upsell source from the CTA', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /see pro/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/pricing?source=upsell-predictions');
  });

  it('persists dismissal and stays hidden on the next render', () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText(UPSELL_COPY.predictions.title)).not.toBeInTheDocument();

    const { container } = renderCard();
    expect(container.firstChild).toBeNull();
  });

  it('honors a legacy "1" dismissal when no rearmKey is given', () => {
    store.set(DISMISS_KEY, '1');
    const { container } = renderCard();
    expect(container.firstChild).toBeNull();
  });

  it('re-arms a legacy dismissal when a rearm token appears', () => {
    store.set(DISMISS_KEY, '1');
    renderCard({ rearmKey: 'fork-1' });
    expect(screen.getByText(UPSELL_COPY.predictions.title)).toBeInTheDocument();
  });

  it('re-arms once per new token, not once globally', () => {
    // Dismiss while fork-1 is past interval.
    renderCard({ rearmKey: 'fork-1' });
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    // Same token: stays dismissed.
    const same = renderCard({ rearmKey: 'fork-1' });
    expect(same.container.firstChild).toBeNull();
    same.unmount();

    // A second, different part crosses its interval: re-arms.
    renderCard({ rearmKey: 'fork-1,shock-2' });
    expect(screen.getByText(UPSELL_COPY.predictions.title)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    // Shrinking back to a covered subset stays dismissed.
    const subset = renderCard({ rearmKey: 'shock-2' });
    expect(subset.container.firstChild).toBeNull();
  });

  it('returns to the base dismissed state when the rearm condition clears', () => {
    renderCard({ rearmKey: 'fork-1' });
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    const { container } = renderCard();
    expect(container.firstChild).toBeNull();
  });

  it('ignores stored dismissals and skips storage when persist is false', () => {
    store.set(DISMISS_KEY, '1');
    const onDismiss = vi.fn();
    renderCard({ persist: false, onDismiss });
    expect(screen.getByText(UPSELL_COPY.predictions.title)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalled();
    // Session-only: the stored value is untouched.
    expect(store.get(DISMISS_KEY)).toBe('1');
  });
});
