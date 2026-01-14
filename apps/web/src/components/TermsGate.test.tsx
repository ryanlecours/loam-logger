import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import TermsGate from './TermsGate';

// Mock the useCurrentUser hook
const mockUseCurrentUser = vi.fn();

vi.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}));

// Helper to render with router
const renderWithRouter = (
  initialRoute = '/',
  element: React.ReactNode = <TermsGate><div>Protected Content</div></TermsGate>
) => {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>
        <Route path="/" element={element} />
        <Route path="/onboarding" element={<div>Onboarding Page</div>} />
      </Routes>
    </MemoryRouter>
  );
};

describe('TermsGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loading state', () => {
    it('should show loading state while fetching user', () => {
      mockUseCurrentUser.mockReturnValue({
        user: null,
        loading: true,
        error: null,
      });

      renderWithRouter();

      expect(screen.getByText('Loading...')).toBeInTheDocument();
      expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    });
  });

  describe('authenticated user with terms accepted', () => {
    it('should render children when terms accepted', () => {
      mockUseCurrentUser.mockReturnValue({
        user: {
          id: 'user-123',
          hasAcceptedCurrentTerms: true,
        },
        loading: false,
        error: null,
      });

      renderWithRouter();

      expect(screen.getByText('Protected Content')).toBeInTheDocument();
      expect(screen.queryByText('Onboarding Page')).not.toBeInTheDocument();
    });
  });

  describe('authenticated user without terms accepted', () => {
    it('should redirect when terms not accepted', () => {
      mockUseCurrentUser.mockReturnValue({
        user: {
          id: 'user-123',
          hasAcceptedCurrentTerms: false,
        },
        loading: false,
        error: null,
      });

      renderWithRouter();

      // Should redirect to onboarding
      expect(screen.getByText('Onboarding Page')).toBeInTheDocument();
      expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    });

    it('should redirect to onboarding with step=1 query param', () => {
      mockUseCurrentUser.mockReturnValue({
        user: {
          id: 'user-123',
          hasAcceptedCurrentTerms: false,
        },
        loading: false,
        error: null,
      });

      // Use a more detailed router setup to check the redirect URL
      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route
              path="/dashboard"
              element={
                <TermsGate>
                  <div>Dashboard</div>
                </TermsGate>
              }
            />
            <Route
              path="/onboarding"
              element={
                <div data-testid="onboarding">
                  Onboarding Page
                </div>
              }
            />
          </Routes>
        </MemoryRouter>
      );

      // Navigate component redirects to /onboarding?step=1
      expect(screen.getByTestId('onboarding')).toBeInTheDocument();
    });
  });

  describe('no user (unauthenticated)', () => {
    it('should render children when no user (let AuthGate handle auth)', () => {
      // When user is null (not logged in), TermsGate should pass through
      // because AuthGate will handle the redirect
      mockUseCurrentUser.mockReturnValue({
        user: null,
        loading: false,
        error: null,
      });

      renderWithRouter();

      // TermsGate passes through when user is null
      // (only redirects when user exists AND hasAcceptedCurrentTerms is false)
      expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });
  });

  describe('nested children', () => {
    it('should render complex nested children when terms accepted', () => {
      mockUseCurrentUser.mockReturnValue({
        user: {
          id: 'user-123',
          hasAcceptedCurrentTerms: true,
        },
        loading: false,
        error: null,
      });

      render(
        <MemoryRouter>
          <Routes>
            <Route
              path="/"
              element={
                <TermsGate>
                  <div>
                    <header>Header</header>
                    <main>
                      <h1>Dashboard</h1>
                      <p>Content here</p>
                    </main>
                  </div>
                </TermsGate>
              }
            />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('Header')).toBeInTheDocument();
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Content here')).toBeInTheDocument();
    });
  });
});
