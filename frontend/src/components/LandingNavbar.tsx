import { Link } from 'react-router-dom';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function LandingNavbar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 border-b"
      style={{
        background: 'rgba(18, 28, 24, 0.2)',
        backdropFilter: 'blur(32px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderColor: 'rgba(168, 208, 184, 0.1)',
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.4)',
      }}
    >
      <div className="container">
        <div className="flex justify-between items-center h-16">
          {/* Logo/Brand */}
          <Link
            to="/"
            className="flex items-center space-x-2 group"
          >
            <span
              className="text-2xl font-bold transition-all duration-300"
              style={{
                background: 'linear-gradient(135deg, rgb(134, 158, 140) 0%, rgb(168, 208, 184) 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text'
              }}
            >
              LoamLogger
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-8">
            <a
              href="#features"
              className="small transition-colors duration-200 hover:opacity-80"
              style={{ color: 'var(--sage)' }}
            >
              Features
            </a>
            <a
              href="#about"
              className="small transition-colors duration-200 hover:opacity-80"
              style={{ color: 'var(--sage)' }}
            >
              Who Is This For?
            </a>
            <Link
              to="/login"
              className="small transition-colors duration-200 hover:opacity-80"
              style={{ color: 'var(--sage)' }}
            >
              Sign In
            </Link>
            <Link
              to="/beta-waitlist"
              className="btn-primary"
              style={{
                padding: '0.75rem 2rem',
                fontSize: '0.875rem',
              }}
            >
              Join Beta
            </Link>
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="md:hidden p-2 rounded-lg transition-colors"
            style={{
              color: 'var(--sage)',
              background: 'transparent'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(134, 158, 140, 0.1)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
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
            style={{
              borderTop: '1px solid rgba(168, 208, 184, 0.1)',
              background: 'rgba(18, 28, 24, 0.95)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
            }}
            className="md:hidden"
          >
            <div className="px-4 py-4 space-y-3">
              <a
                href="#features"
                onClick={() => setIsMobileMenuOpen(false)}
                className="block px-4 py-2 rounded-lg transition-colors small"
                style={{ color: 'var(--sage)' }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(134, 158, 140, 0.1)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                Features
              </a>
              <a
                href="#about"
                onClick={() => setIsMobileMenuOpen(false)}
                className="block px-4 py-2 rounded-lg transition-colors small"
                style={{ color: 'var(--sage)' }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(134, 158, 140, 0.1)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                Who Is This For?
              </a>
              <Link
                to="/login"
                onClick={() => setIsMobileMenuOpen(false)}
                className="block px-4 py-2 rounded-lg transition-colors small"
                style={{ color: 'var(--sage)' }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(134, 158, 140, 0.1)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                Sign In
              </Link>
              <Link
                to="/beta-waitlist"
                onClick={() => setIsMobileMenuOpen(false)}
                className="btn-primary block text-center"
                style={{
                  padding: '0.75rem 2rem',
                  fontSize: '0.875rem',
                }}
              >
                Join Beta
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
