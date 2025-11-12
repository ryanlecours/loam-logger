import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import Home from './pages/Home';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import NotFound from './pages/NotFound';
import Rides from './pages/Rides';
import Settings from './pages/Settings';
import NavBar from './components/NavBar';
import AuthComplete from './pages/AuthComplete';

import AuthGate from './components/AuthGate'; // ⬅️ new

import './App.css';

function Page({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.main
      initial={{ opacity: 0, y: reduce ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduce ? 0 : -8 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="mx-auto px-4 py-6 min-h-screen"
    >
      {children}
    </motion.main>
  );
}

function AppRoutes() {
  const location = useLocation();
  const isAuthPage = location.pathname === '/' || location.pathname === '/login';

  return (
    <>
      {!isAuthPage && <NavBar />}

      <AnimatePresence mode="wait" initial={false}>
        <Routes location={location} key={location.pathname}>
          {/* Public */}
          <Route path="/" element={<Page><Home /></Page>} />
          <Route path="/login" element={<Page><Login /></Page>} />
          <Route path="/auth/complete" element={<AuthComplete />} />

          {/* Protected */}
          <Route
            path="/dashboard"
            element={
              <AuthGate>
                <Page><Dashboard /></Page>
              </AuthGate>
            }
          />
          <Route
            path="/rides"
            element={
              <AuthGate>
                <Page><Rides /></Page>
              </AuthGate>
            }
          />
          <Route
            path="/settings"
            element={
              <AuthGate>
                <Page><Settings /></Page>
              </AuthGate>
            }
          />

          {/* 404 */}
          <Route path="*" element={<Page><NotFound /></Page>} />
        </Routes>
      </AnimatePresence>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
