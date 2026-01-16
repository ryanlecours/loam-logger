import type { ReactNode } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import MarketingLanding from './pages/MarketingLanding';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import NotFound from './pages/NotFound';
import Rides from './pages/Rides';
import Settings from './pages/Settings';
import Gear from './pages/Gear';
import BikeDetail from './pages/BikeDetail';
import Admin from './pages/Admin';
import AuthComplete from './pages/AuthComplete';
import BetaTesterWaitlist from './pages/BetaTesterWaitlist';
import ClosedBeta from './pages/ClosedBeta';
import AlreadyOnWaitlist from './pages/AlreadyOnWaitlist';
import ChangePassword from './pages/ChangePassword';

import AuthGate from './components/AuthGate';
import AppShell from './components/layout/AppShell';
import OnboardingGate from './components/OnboardingGate';
import TermsGate from './components/TermsGate';
import { ToastProvider } from './components/ui/Toast';
import Onboarding from './pages/Onboarding';

import './App.css';
import PrivacyPolicy from './pages/PrivacyPolicy';
import Terms from './pages/Terms';
import Pricing from './pages/Pricing';
import Disclaimer from './pages/Disclaimer';
import About from './pages/About';
import Support from './pages/Support';

function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  const classes = className ?? 'mx-auto min-h-screen';
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
      <TermsGate>
        <OnboardingGate>
          <AppShell>{children}</AppShell>
        </OnboardingGate>
      </TermsGate>
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
          <Route path="/" element={<MarketingLanding />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/pricing" element={<Page><Pricing /></Page>} />
          <Route path="/disclaimer" element={<Page><Disclaimer /></Page>} />
          <Route path="/about" element={<Page><About /></Page>} />
          <Route path="/support" element={<Page><Support /></Page>} />
          <Route path="/login" element={<Page><Login /></Page>} />
          <Route path="/beta-waitlist" element={<Page><BetaTesterWaitlist /></Page>} />
          <Route path="/closed-beta" element={<Page><ClosedBeta /></Page>} />
          <Route path="/already-on-waitlist" element={<Page><AlreadyOnWaitlist /></Page>} />
          <Route path="/change-password" element={<Page><ChangePassword /></Page>} />
          <Route path="/auth/complete" element={<AuthComplete />} />

          {/* Onboarding */}
          <Route path="/onboarding" element={<AuthGate><Page><Onboarding /></Page></AuthGate>} />

          {/* Protected */}
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/rides" element={<ProtectedRoute><Rides /></ProtectedRoute>} />
          <Route path="/gear" element={<ProtectedRoute><Gear /></ProtectedRoute>} />
          <Route path="/gear/:bikeId" element={<ProtectedRoute><BikeDetail /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />

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
      <ToastProvider />
    </BrowserRouter>
  );
}
