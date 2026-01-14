import { useState, useMemo } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useApolloClient } from '@apollo/client';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { getAuthHeaders, clearCsrfToken } from '@/lib/csrf';
import Footer from './Footer';

const BASE_NAV_LINKS = [
  { label: 'Dashboard', path: '/dashboard' },
  { label: 'My Bikes', path: '/gear' },
  { label: 'Rides', path: '/rides' },
  { label: 'Settings', path: '/settings' },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const apollo = useApolloClient();
  const reduceMotion = useReducedMotion();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { user } = useCurrentUser();

  const navLinks = useMemo(() => {
    const links = [...BASE_NAV_LINKS];
    if (user?.role === 'ADMIN') {
      links.push({ label: 'Admin', path: '/admin' });
    }
    return links;
  }, [user?.role]);

  const handleLogout = async () => {
    try {
      await fetch(`${import.meta.env.VITE_API_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      clearCsrfToken();
      await apollo.clearStore();
      navigate('/login');
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
  };

  return (
    <div className="app-shell">
      <nav className="fixed top-0 left-0 right-0 z-50 border-b app-navbar">
        <div className="container">
          <div className="flex justify-between items-center h-16">
            {/* Logo/Brand */}
            <NavLink
              to="/dashboard"
              className="flex items-center space-x-2 group"
            >
              <span className="text-2xl font-bold logo-gradient">
                LoamLogger
              </span>
            </NavLink>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center space-x-2">
              {navLinks.map(({ label, path }) => (
                <NavLink
                  key={path}
                  to={path}
                  className="nav-link"
                  end={path !== '/dashboard'}
                >
                  {({ isActive }) => (
                    <>
                      <AnimatePresence>
                        {isActive && (
                          <motion.span
                            layoutId="nav-active-pill"
                            className="absolute inset-0 rounded-lg nav-active-pill"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ type: "spring", stiffness: 400, damping: 28 }}
                          />
                        )}
                      </AnimatePresence>
                      <span className="relative z-10">{label}</span>
                    </>
                  )}
                </NavLink>
              ))}

              <button
                onClick={handleLogout}
                className="ml-4 nav-logout"
              >
                Logout
              </button>
            </div>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden nav-menu-btn"
              aria-label="Toggle menu"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                {isMobileMenuOpen ? (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                ) : (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="md:hidden mobile-menu"
            >
              <div className="px-4 py-4 space-y-1">
                {navLinks.map(({ label, path }) => (
                  <NavLink
                    key={path}
                    to={path}
                    onClick={closeMobileMenu}
                    className={({ isActive }) =>
                      `nav-link-mobile ${isActive ? 'nav-link-mobile-active' : ''}`
                    }
                    end={path !== '/dashboard'}
                  >
                    {label}
                  </NavLink>
                ))}

                <button
                  onClick={() => {
                    closeMobileMenu();
                    handleLogout();
                  }}
                  className="block w-full text-left nav-link-mobile"
                >
                  Logout
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>

      {/* Spacer to account for fixed navbar */}
      <div className="h-16" />

      <motion.main
        className="app-shell__content"
        initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: reduceMotion ? 0 : -12 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      >
        {children}
      </motion.main>

      <Footer />
    </div>
  );
}
