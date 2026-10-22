import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { mockUseOutageNotice } = vi.hoisted(() => ({
  mockUseOutageNotice: vi.fn<() => { message: string } | null>(),
}));

vi.mock('@/hooks/useOutageNotice', () => ({ useOutageNotice: mockUseOutageNotice }));

import OutageBanner from './OutageBanner';

const DISMISSED_KEY = 'loam.outageBanner.dismissed';

describe('OutageBanner', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    mockUseOutageNotice.mockReturnValue(null);
  });

  it('renders nothing while there is no notice', () => {
    const { container } = render(<OutageBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('announces the notice as a status region', () => {
    mockUseOutageNotice.mockReturnValue({ message: 'Loam Logger is experiencing a service outage.' });
    render(<OutageBanner />);

    expect(screen.getByRole('status')).toHaveTextContent('Loam Logger is experiencing a service outage.');
    expect(screen.getByRole('button', { name: 'Dismiss outage notice' })).toBeInTheDocument();
  });

  it('hides for the rest of the tab session once dismissed', () => {
    mockUseOutageNotice.mockReturnValue({ message: 'Back soon.' });
    render(<OutageBanner />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss outage notice' }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(DISMISSED_KEY)).toBe('Back soon.');
  });

  it('stays hidden on a later mount for the same message', () => {
    window.sessionStorage.setItem(DISMISSED_KEY, 'Back soon.');
    mockUseOutageNotice.mockReturnValue({ message: 'Back soon.' });
    render(<OutageBanner />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('comes back when the message changes after a dismissal', () => {
    window.sessionStorage.setItem(DISMISSED_KEY, 'Back soon.');
    mockUseOutageNotice.mockReturnValue({ message: 'Restored. Syncs are catching up.' });
    render(<OutageBanner />);

    expect(screen.getByRole('status')).toHaveTextContent('Restored. Syncs are catching up.');
  });
});
