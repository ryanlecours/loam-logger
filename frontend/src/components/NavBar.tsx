import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useApolloClient } from '@apollo/client'

export default function Navbar() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const apollo = useApolloClient()

  const navLinks = [
    { label: 'Dashboard', path: '/dashboard' },
    { label: 'Rides', path: '/rides' },
    { label: 'Gear', path: '/gear' },
    { label: 'Settings', path: '/settings' },
  ]

  const handleLogout = async () => {
    try {
      // Call backend logout to clear session cookie
      await fetch(`${import.meta.env.VITE_API_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      })

      // Clear Apollo cache so viewer becomes null immediately
      await apollo.clearStore()

      // Redirect to login page
      navigate('/login')
    } catch (err) {
      console.error('Logout failed:', err)
    }
  }

  return (
    <nav className="bg-surface-2 shadow-sm sticky top-0 z-50">
      <div className="mx-auto px-4">
        <div className="flex justify-between items-center h-16">
          {/* App name */}
          <Link to="/dashboard" className="text-xl font-bold">
            LoamLogger
          </Link>

          {/* Links + Logout */}
          <div className="flex items-center gap-6">
            {navLinks.map(({ label, path }) => (
              <Link
                key={label}
                to={path}
                className={`text-sm font-medium hover:text-black ${
                  pathname === path ? '' : 'text-accent-contrast'
                }`}
              >
                {label}
              </Link>
            ))}

            {/* Logout button */}
            <button
              onClick={handleLogout}
              className="text-sm font-medium text-accent-contrast hover:text-black transition"
            >
              Logout
            </button>
          </div>
        </div>
      </div>
    </nav>
  )
}
