import { Link } from 'react-router';
import { ArrowDown } from 'lucide-react';
import RidgeLines from './RidgeLines';

export default function HeroSection() {
  return (
    <section className="lp-hero" data-testid="hero">
      <picture>
        <source media="(max-width: 767px)" srcSet="/heroFernsMobile.jpg" width={1200} height={800} />
        <img
          className="lp-hero__photo"
          src="/heroFerns.jpg"
          width={2048}
          height={1365}
          alt="Two riders charging through waist-high sword ferns on Pacific Northwest singletrack"
          fetchPriority="high"
        />
      </picture>
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
            Free for one bike, with no card and no trial clock. Web and iOS.
          </p>
        </div>
      </div>
    </section>
  );
}
