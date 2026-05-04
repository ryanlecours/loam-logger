import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Admin from './index';

// Mock the section components — we're testing the role gate + section
// router here, not the section internals. Each section gets a unique
// data-testid so we can assert which one rendered.
vi.mock('./sections/OverviewSection', () => ({
  OverviewSection: () => <div data-testid="overview-section" />,
}));
vi.mock('./sections/UsersSection', () => ({
  UsersSection: () => <div data-testid="users-section" />,
}));
vi.mock('./sections/WaitlistSection', () => ({
  WaitlistSection: () => <div data-testid="waitlist-section" />,
}));
vi.mock('./sections/EmailSection', () => ({
  EmailSection: () => <div data-testid="email-section" />,
}));

// Stub the shell so we don't drag in framer-motion or the sidebar markup.
// The shell forwards the resolved `section` to its children render-prop —
// reproduce that contract using the underlying `useAdminSection` hook.
//
// The inner component is named (not anonymous via `default: () => …`) so
// react-hooks/rules-of-hooks recognises it as a React component and
// permits the `useAdminSection()` call. An anonymous arrow inside the
// mock factory triggers the rule's "Hook called in function `default`
// that is neither a component nor a custom Hook" error.
vi.mock('./AdminShell', async () => {
  const { useAdminSection } = await import('./useAdminSection');
  function MockAdminShell({
    children,
  }: {
    children: (section: unknown) => React.ReactNode;
  }) {
    const { section } = useAdminSection();
    return <>{children(section)}</>;
  }
  return { default: MockAdminShell };
});

const mockUseCurrentUser = vi.fn();
vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}));

// react-router-dom <Navigate> renders a sentinel marker so we can assert
// the redirect was issued without actually navigating.
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
  };
});

function renderAdmin(initialEntries = ['/admin']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Admin />
    </MemoryRouter>,
  );
}

describe('Admin', () => {
  beforeEach(() => {
    mockUseCurrentUser.mockReset();
  });

  it('shows a loading spinner while the current user resolves', () => {
    mockUseCurrentUser.mockReturnValue({ user: undefined, loading: true });
    renderAdmin();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('overview-section')).not.toBeInTheDocument();
  });

  it('redirects non-admin users to /dashboard', () => {
    // Pin the gate: any role other than ADMIN must bounce. This is the
    // last line of defense in the client — server-side admin endpoints
    // also enforce, but the redirect prevents a non-admin from briefly
    // rendering admin UI before a server 401 fires.
    mockUseCurrentUser.mockReturnValue({
      user: { id: 'u1', role: 'PRO' },
      loading: false,
    });
    renderAdmin();

    const nav = screen.getByTestId('navigate');
    expect(nav).toHaveAttribute('data-to', '/dashboard');
    expect(screen.queryByTestId('overview-section')).not.toBeInTheDocument();
  });

  it('redirects when there is no user (post-logout)', () => {
    mockUseCurrentUser.mockReturnValue({ user: null, loading: false });
    renderAdmin();
    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/dashboard');
  });

  it('renders the Overview section by default for an admin', () => {
    mockUseCurrentUser.mockReturnValue({
      user: { id: 'u1', role: 'ADMIN' },
      loading: false,
    });
    renderAdmin();
    expect(screen.getByTestId('overview-section')).toBeInTheDocument();
  });

  it.each([
    ['users', 'users-section'],
    ['waitlist', 'waitlist-section'],
    ['email', 'email-section'],
  ] as const)('renders the %s section when ?section=%s', (section, testId) => {
    mockUseCurrentUser.mockReturnValue({
      user: { id: 'u1', role: 'ADMIN' },
      loading: false,
    });
    renderAdmin([`/admin?section=${section}`]);
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });
});
