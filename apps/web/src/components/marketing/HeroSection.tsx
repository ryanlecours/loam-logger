import { Link } from 'react-router';
import { ArrowDown } from 'lucide-react';
import RidgeLines from './RidgeLines';

export default function HeroSection() {
  return (
    <section className="lp-hero" data-testid="hero">
      <img
        className="lp-hero__photo"
        src="/IngridLoam.jpg"
        alt="Rider threading a dark stand of firs on loamy Pacific Northwest singletrack"
        fetchPriority="high"
      />
      <div className="lp-hero__shade" aria-hidden="true" />
      <div className="lp-hero__scrim" aria-hidden="true" />
      <RidgeLines />

      <div className="lp-container lp-hero__content" id="top">
        <div className="lp-hero__copy">
          <h1 className="lp-h1">
            Anyone can track a ride. <em>Loam Logger tracks your bike.</em>
          </h1>
          <p className="lp-lede">
            You already record every ride. Loam Logger takes the hours from those rides, puts them
            on the fork, the shock, the pads, the chain, whatever&apos;s on the bike, and tells you
            which ones are due.
          </p>
          <div className="lp-actions">
            <Link to="/signup" className="lp-btn lp-btn--primary">
              Start free
            </Link>
            <a href="#how" className="lp-btn lp-btn--ghost">
              <span>How it counts hours</span>
              <ArrowDown size={18} aria-hidden="true" />
            </a>
          </div>
          <p className="lp-fine">
            Free for one bike, no card. Web and iOS. Works off Garmin Connect™, Strava or WHOOP.
          </p>
        </div>
      </div>
    </section>
  );
}
