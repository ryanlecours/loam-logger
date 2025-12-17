import { Link } from 'react-router';

export default function MarketingFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-mkt-charcoal border-t border-mkt-slate/30">
      <div className="mkt-container py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <img
                src="/web-app-manifest-192x192.png"
                alt="Loam Logger"
                className="w-10 h-10 rounded-lg"
              />
              <h3 className="text-xl font-bold text-mkt-cream">Loam Logger</h3>
            </div>
            <p className="text-sm text-mkt-concrete">
              Track every ride. Optimize every component. Never miss a service again.
            </p>
          </div>

          {/* Links */}
          <div>
            <h4 className="text-sm font-semibold text-mkt-sand uppercase tracking-wider mb-4">
              Product
            </h4>
            <ul className="space-y-2">
              <li>
                <Link
                  to="/beta-waitlist"
                  className="text-sm text-mkt-concrete hover:text-mkt-mint transition"
                >
                  Join Beta Waitlist
                </Link>
              </li>
              <li>
                <Link
                  to="/login"
                  className="text-sm text-mkt-concrete hover:text-mkt-mint transition"
                >
                  Sign In
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="text-sm font-semibold text-mkt-sand uppercase tracking-wider mb-4">
              Legal
            </h4>
            <ul className="space-y-2">
              <li>
                <Link
                  to="/privacy"
                  className="text-sm text-mkt-concrete hover:text-mkt-mint transition"
                >
                  Privacy Policy
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="pt-8 border-t border-mkt-slate/30">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-xs text-mkt-concrete">
              © {currentYear} Loam Logger. Built by riders, for riders.
            </p>
            <p className="text-xs text-mkt-concrete">
              Made with ❤️ for the MTB community
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
