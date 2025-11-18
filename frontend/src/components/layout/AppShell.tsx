import { NavLink, useNavigate } from 'react-router-dom';
import { useApolloClient } from '@apollo/client';
import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';
import { useCurrentUser } from '../../hooks/useCurrentUser';

const NAV_LINKS = [
  { label: 'Dashboard', path: '/dashboard' },
  { label: 'My Bikes', path: '/gear' },
  { label: 'Rides', path: '/rides' },
  { label: 'Settings', path: '/settings' },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const apollo = useApolloClient();
  const reduceMotion = useReducedMotion();

  const firstName = user?.name?.split(' ')?.[0] ?? 'Rider';

  const handleLogout = async () => {
    try {
      await fetch(`${import.meta.env.VITE_API_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
      await apollo.clearStore();
      navigate('/login');
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  return (
    <div className="app-shell">
      <header className="app-shell__header">
        <div className="app-shell__headerRow">
          <div className="app-shell__brand">
            <div className="app-shell__logo" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <circle cx="8" cy="17" r="2.5" stroke="#7ACE8A" strokeWidth="1.8" />
                <circle cx="18" cy="17" r="2.5" stroke="#7ACE8A" strokeWidth="1.8" />
                <path
                  d="M5 17H7.6L10 9.5H7.5"
                  stroke="#7ACE8A"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M14 6L18 17H16.2L12.3 8.1L10 15"
                  stroke="#7ACE8A"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="app-shell__title">
              <h1>Loam Logger</h1>
              <span>Welcome back, {firstName}!</span>
            </div>
          </div>

          <div className="app-shell__actions">
            <nav className="app-shell__tabs" aria-label="Primary navigation">
              {NAV_LINKS.map(({ label, path }) => (
                <NavLink
                  key={path}
                  to={path}
                  className={({ isActive }) =>
                    ['app-shell__tab', isActive ? 'app-shell__tab--active' : '']
                      .filter(Boolean)
                      .join(' ')
                  }
                  end={path !== '/dashboard'}
                >
                  {label}
                </NavLink>
              ))}
            </nav>
            <button className="app-shell__logout" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </div>
      </header>

      <motion.main
        className="app-shell__content"
        initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: reduceMotion ? 0 : -12 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      >
        {children}
      </motion.main>
    </div>
  );
}
