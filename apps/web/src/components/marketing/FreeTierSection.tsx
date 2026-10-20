import { Link } from 'react-router';
import { Check } from 'lucide-react';

/**
 * The landing page's one commercial statement: Free is the product for a
 * one-bike rider, not a trial. Pro gets a single honest footnote and a link;
 * the comparison table lives on /pricing.
 */
const included = [
  'All 23+ component types, with the hours on each part counted against the interval you set',
  'Automatic ride sync from Garmin Connect™, Strava or WHOOP',
  'A flag the moment a part is past its interval',
  'A service log with dates and hours, kept for the life of the part',
  'Bike specs imported from 99spokes',
];

export default function FreeTierSection() {
  return (
    <section id="free" className="lp-section">
      <div className="lp-container lp-free">
        <div className="lp-free__text">
          <h2 className="lp-h2">Free for one bike, for good.</h2>
          <p className="lp-copy">
            It isn&apos;t a trial and nothing expires. Add your main bike, connect the platform you
            already record with, and it keeps counting for as long as you ride it.
          </p>
          <div className="lp-actions">
            <Link to="/signup" className="lp-btn lp-btn--primary">
              Start free
            </Link>
          </div>
          <p className="lp-free__note">
            Pro is for the quiver: unlimited bikes, a due-soon heads-up with the rides left on each
            part, service alerts and a weekly check, weather on every ride, PDF export. $39.99 a year,
            less than one fork service.{' '}
            <Link to="/pricing?source=landing-free-note">Details on the pricing page.</Link>
          </p>
        </div>

        <ul className="lp-free__card" aria-label="What the free tier includes">
          {included.map((item) => (
            <li key={item}>
              <Check size={18} className="lp-plan__check" aria-hidden="true" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
