import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useApolloClient } from "@apollo/client";
import { motion, AnimatePresence } from "motion/react";

export default function Navbar() {
  const navigate = useNavigate();
  const apollo = useApolloClient();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navLinks = [
    { label: "Dashboard", path: "/dashboard" },
    { label: "Rides", path: "/rides" },
    { label: "Gear", path: "/gear" },
    { label: "Settings", path: "/settings" },
  ];

  const handleLogout = async () => {
    try {
      await fetch(`${import.meta.env.VITE_API_URL}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
      await apollo.clearStore();
      navigate("/login");
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
  };

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
          <NavLink
            to="/dashboard"
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
          </NavLink>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-2">
            {navLinks.map(({ label, path }) => (
              <NavLink
                key={label}
                to={path}
                className={({ isActive }) =>
                  [
                    "relative px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                    isActive ? "" : "hover:opacity-80",
                  ].join(" ")
                }
                style={{ color: 'var(--sage)' }}
                end
              >
                {({ isActive }) => (
                  <>
                    <AnimatePresence>
                      {isActive && (
                        <motion.span
                          layoutId="nav-active-pill"
                          className="absolute inset-0 rounded-lg"
                          style={{ background: 'rgba(134, 158, 140, 0.15)' }}
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
              className="ml-4 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 hover:opacity-80"
              style={{ color: 'var(--sage)' }}
            >
              Logout
            </button>
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
            <div className="px-4 py-4 space-y-1">
              {navLinks.map(({ label, path }) => (
                <NavLink
                  key={label}
                  to={path}
                  onClick={closeMobileMenu}
                  className={({ isActive }) =>
                    [
                      "block px-4 py-3 rounded-lg text-sm font-medium transition-colors",
                      isActive ? "" : "",
                    ].join(" ")
                  }
                  style={{ color: 'var(--sage)' }}
                  end
                >
                  {({ isActive }) => (
                    <span
                      className="block px-4 py-3 -mx-4 -my-3 rounded-lg transition-colors"
                      style={{
                        background: isActive ? 'rgba(134, 158, 140, 0.15)' : 'transparent',
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) e.currentTarget.style.background = 'rgba(134, 158, 140, 0.1)';
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      {label}
                    </span>
                  )}
                </NavLink>
              ))}

              <button
                onClick={() => {
                  closeMobileMenu();
                  handleLogout();
                }}
                className="block w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-colors"
                style={{ color: 'var(--sage)' }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(134, 158, 140, 0.1)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                Logout
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
