import { NavLink, useNavigate } from "react-router-dom";
import { useApolloClient } from "@apollo/client";
import { motion, AnimatePresence } from "motion/react";

export default function Navbar() {
  const navigate = useNavigate();
  const apollo = useApolloClient();

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

  return (
    <nav className="bg-surface-2 shadow-sm sticky top-0 z-50">
      <div className="mx-auto px-4">
        <div className="flex justify-between items-center h-16">
          <NavLink to="/dashboard" className="text-xl font-bold">
            LoamLogger
          </NavLink>

          {/* Links + Logout */}
          <div className="flex items-center gap-2">
            {navLinks.map(({ label, path }) => (
              <NavLink
                key={label}
                to={path}
                className={({ isActive }) =>
                  [
                    "relative group rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    // base text color
                    isActive ? "text-accent" : "text-accent-contrast hover:text-black",
                    // hover outline for non-active links
                    "hover:ring-1 hover:ring-primary/40 hover:ring-offset-1 hover:ring-offset-surface-1",
                  ].join(" ")
                }
                end
              >
                {({ isActive }) => (
                  <>
                    {/* Animated active pill */}
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

                    {/* Label sits above the pill */}
                    <span className="relative z-10">{label}</span>
                  </>
                )}
              </NavLink>
            ))}

            {/* Logout button */}
            <button
              onClick={handleLogout}
              className="ml-2 cursor-pointer rounded-lg px-3 py-2 text-sm font-medium text-accent-contrast hover:text-black transition hover:ring-1 hover:ring-primary/40 hover:ring-offset-1 hover:ring-offset-surface-1"
            >
              Logout
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
