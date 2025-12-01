import type { ReactNode } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import Home from './pages/Home';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import NotFound from './pages/NotFound';
import Rides from './pages/Rides';
import Settings from './pages/Settings';
import Gear from './pages/Gear';
import AuthComplete from './pages/AuthComplete';
import BetaTesterWaitlist from './pages/BetaTesterWaitlist';

import AuthGate from './components/AuthGate';
import AppShell from './components/layout/AppShell';
import OnboardingGate from './components/OnboardingGate';
import Onboarding from './pages/Onboarding';

import './App.css';
import PrivacyPolicy from './pages/PrivacyPolicy';

function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  const classes = className ?? 'mx-auto px-4 py-6 min-h-screen';
  return (
    <motion.main
      initial={{ opacity: 0, y: reduce ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduce ? 0 : -8 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className={classes}
    >
      {children}
    </motion.main>
  );
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <OnboardingGate>
        <AppShell>{children}</AppShell>
      </OnboardingGate>
    </AuthGate>
  );
}

function AppRoutes() {
  const location = useLocation();

  return (
    <>
      <AnimatePresence mode="wait" initial={false}>
        <Routes location={location} key={location.pathname}>
          {/* Public */}
          <Route path="/" element={<Page><Home /></Page>} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/login" element={<Page><Login /></Page>} />
          <Route path="/beta-waitlist" element={<Page><BetaTesterWaitlist /></Page>} />
          <Route path="/auth/complete" element={<AuthComplete />} />

          {/* Onboarding */}
          <Route path="/onboarding" element={<AuthGate><Page><Onboarding /></Page></AuthGate>} />

          {/* Protected */}
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/rides" element={<ProtectedRoute><Rides /></ProtectedRoute>} />
          <Route path="/gear" element={<ProtectedRoute><Gear /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />

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
