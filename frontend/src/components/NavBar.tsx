import { Link, useLocation } from 'react-router-dom';

export default function Navbar() {
  const { pathname } = useLocation();

  const navLinks = [
    { label: 'Dashboard', path: '/dashboard' },
    { label: 'Rides', path: '/rides' },
    { label: 'Gear', path: '/gear' },
    { label: 'Settings', path: '/settings' },
  ];

  return (
    <nav className="bg-white shadow-sm sticky top-0 z-50">
      <div className="mx-auto px-4">
        <div className="flex justify-between items-center h-16">
          {/* App name */}
          <Link to="/" className="text-xl font-bold text-gray-800">
            LoamLogger
          </Link>

          {/* Links */}
          <div className="flex gap-6">
            {navLinks.map(({ label, path }) => (
              <Link
                key={label}
                to={path}
                className={`text-sm font-medium hover:text-black ${
                  pathname === path ? 'text-black' : 'text-gray-500'
                }`}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}
