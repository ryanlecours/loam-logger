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
    <nav className="bg-surface-2 shadow-sm sticky top-0 z-50">
      <div className="mx-auto px-4">
        <div className="flex justify-between items-center h-16">
          <NavLink to="/dashboard" className="text-xl font-bold">
            LoamLogger
          </NavLink>

          {/* Desktop Links + Logout - Hidden on mobile, visible on md+ */}
          <div className="hidden md:flex items-center gap-2">
            {navLinks.map(({ label, path }) => (
              <NavLink
                key={label}
                to={path}
                className={({ isActive }) =>
                  [
                    "relative group rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    isActive ? "text-accent" : "text-accent-contrast hover:text-black",
                    "hover:ring-1 hover:ring-primary/40 hover:ring-offset-1 hover:ring-offset-surface-1",
                  ].join(" ")
                }
                end
              >
                {({ isActive }) => (
                  <>
                    <AnimatePresence>
                      {isActive && (
                        <motion.span
                          layoutId="nav-active-pill"
                          className="absolute inset-0 rounded-lg bg-primary/10"
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
              className="ml-2 cursor-pointer rounded-lg px-3 py-2 text-sm font-medium text-accent-contrast hover:text-black transition hover:ring-1 hover:ring-primary/40 hover:ring-offset-1 hover:ring-offset-surface-1"
            >
              Logout
            </button>
          </div>

          {/* Mobile Hamburger - Visible on mobile, hidden on md+ */}
          <button
            className="flex md:hidden p-2 rounded-lg hover:bg-surface-accent transition text-white"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="Toggle menu"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
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

        {/* Mobile Menu Dropdown */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <motion.div
              className="md:hidden pb-4"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="flex flex-col space-y-2">
                {navLinks.map(({ label, path }) => (
                  <NavLink
                    key={label}
                    to={path}
                    onClick={closeMobileMenu}
                    className={({ isActive }) =>
                      [
                        "rounded-lg px-4 py-3 text-sm font-medium transition-colors",
                        isActive
                          ? "bg-primary/10 text-accent"
                          : "text-accent-contrast hover:bg-surface-accent",
                      ].join(" ")
                    }
                    end
                  >
                    {label}
                  </NavLink>
                ))}

                <button
                  onClick={() => {
                    closeMobileMenu();
                    handleLogout();
                  }}
                  className="rounded-lg px-4 py-3 text-sm font-medium text-accent-contrast hover:bg-surface-accent transition text-left"
                >
                  Logout
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </nav>
  );
}
