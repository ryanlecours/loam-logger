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
import Bikes from './pages/Bikes';

import './App.css';

function Page({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, y: reduce ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduce ? 0 : -8 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className="mx-auto px-4 py-6"  // ⬅️ removed min-h-screen
    >
      {children}
    </motion.div>
  );
}

function AppRoutes() {
  const location = useLocation();
  const isAuthPage = location.pathname === '/' || location.pathname === '/login';

  return (
    // App shell: full viewport height, column layout, only main scrolls
    <div className="h-dvh flex flex-col bg-app overflow-hidden">
      {!isAuthPage && (
        <div className="sticky top-0 z-50 bg-surface border-b border-app">
          <NavBar />
        </div>
      )}

      <main className="flex-1 min-h-0 overflow-y-auto">
        <AnimatePresence mode="wait" initial={false}>
          <Routes location={location} key={location.pathname}>
            <Route path="/" element={<Page><Home /></Page>} />
            <Route path="/login" element={<Page><Login /></Page>} />
            <Route path="/dashboard" element={<Page><Dashboard /></Page>} />
            <Route path="/rides" element={<Page><Rides /></Page>} />
            <Route path="/gear" element={<Page><Bikes /></Page>} />
            <Route path="/settings" element={<Page><Settings /></Page>} />
            <Route path="/auth/complete" element={<AuthComplete />} />
            <Route path="*" element={<Page><NotFound /></Page>} />
          </Routes>
        </AnimatePresence>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
