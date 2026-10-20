import { Link } from 'react-router';
import { Check } from 'lucide-react';

const freeFeatures = [
  '1 bike',
  'All 23+ component types',
  'Automatic ride sync',
  'Service log and hours per part',
];

const proFeatures = [
  'Unlimited bikes',
  'Rides left until each part is due',
  'Service-due alert and a weekly bike check',
  'Weather on every ride',
  'PDF service history, for when you sell',
  'Full ride history import',
];

function Feature({ children }: { children: string }) {
  return (
    <li>
      <Check size={18} className="lp-plan__check" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}

export default function PricingSection() {
  return (
    <section id="pricing" className="lp-section">
      <div className="lp-container">
        <div className="lp-pricing__head">
          <h2 className="lp-h2">One bike is free. The fleet is five bucks.</h2>
          <p className="lp-copy">No card for Free. Cancel Pro from the app, no email to anyone.</p>
        </div>

        <div className="lp-plans">
          <div className="lp-plan">
            <div className="lp-plan__head">
              <span className="lp-plan__tier">Free</span>
              <span className="lp-plan__amount">$0</span>
              <span className="lp-plan__tagline">The whole tracker, for one bike</span>
            </div>
            <ul className="lp-plan__list">
              {freeFeatures.map((f) => (
                <Feature key={f}>{f}</Feature>
              ))}
            </ul>
            <Link to="/signup" className="lp-btn lp-btn--outline lp-btn--compact">
              Start free
            </Link>
          </div>

          <div className="lp-plan lp-plan--pro">
            <div className="lp-plan__head">
              <span className="lp-plan__tier">Pro</span>
              <span className="lp-plan__price">
                <span className="lp-plan__amount">$4.99</span>
                <span className="lp-plan__period">a month, or $39.99 a year</span>
              </span>
              <span className="lp-plan__tagline">Every bike you own, plus the reminders</span>
            </div>
            <ul className="lp-plan__list">
              {proFeatures.map((f) => (
                <Feature key={f}>{f}</Feature>
              ))}
            </ul>
            <Link to="/pricing?source=landing-pricing" className="lp-btn lp-btn--primary lp-btn--compact">
              Go Pro
            </Link>
          </div>
        </div>

        <p className="lp-pricing__note">
          Founding Riders keep their tier. USD. Stripe on the web, the App Store on iOS.
        </p>
      </div>
    </section>
  );
}
