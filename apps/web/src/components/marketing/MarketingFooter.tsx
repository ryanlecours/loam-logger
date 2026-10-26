import { Link } from 'react-router';
import StoreBadges from './StoreBadges';

export default function MarketingFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="lp-footer">
      <div className="lp-container">
        <div className="lp-footer__inner">
          <div className="lp-footer__brand">
            <div className="lp-footer__wordmark">
              <img src="/web-app-manifest-192x192.png" alt="" />
              <span>Loam Logger</span>
            </div>
            <p className="lp-footer__about">
              Service tracking for mountain bikes. Built by Ryan LeCours at Loam Labs, in the Pacific
              Northwest, between rides.
            </p>
            <StoreBadges size="sm" />
            <p className="lp-footer__legal">
              Garmin Connect is a trademark of Garmin Ltd. or its subsidiaries. Ride data is
              attributed to the device that recorded it. Apple and the App Store are trademarks of
              Apple Inc. Google Play and the Google Play logo are trademarks of Google LLC.
            </p>
          </div>

          <nav className="lp-footer__nav" aria-label="Footer">
            <div className="lp-footer__col">
              <span className="lp-eyebrow">Product</span>
              <Link to="/#how">How it works</Link>
              <Link to="/app">iOS and Android apps</Link>
              <Link to="/pricing?source=marketing-footer">Pricing</Link>
              <Link to="/support">Support</Link>
              <Link to="/login">Log in</Link>
            </div>
            <div className="lp-footer__col">
              <span className="lp-eyebrow">Company</span>
              <Link to="/about">About</Link>
              <Link to="/privacy">Privacy</Link>
              <Link to="/terms">Terms</Link>
            </div>
          </nav>
        </div>

        <div className="lp-footer__attrib">
          <span className="lp-footer__legal">Bike specifications and component data</span>
          <a href="https://99spokes.com" target="_blank" rel="noopener noreferrer">
            <img src="/logos/powered-by-99-spokes-for-dark-bg.svg" alt="Powered by 99 Spokes" />
          </a>
        </div>

        <p className="lp-footer__copyright">© {currentYear} Loam Labs LLC.</p>
      </div>
    </footer>
  );
}
