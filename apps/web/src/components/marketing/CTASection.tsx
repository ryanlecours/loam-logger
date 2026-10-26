import { Link } from 'react-router';
import StoreBadges from './StoreBadges';

export default function CTASection() {
  return (
    <section className="lp-cta">
      <img
        className="lp-cta__photo"
        src="/goldenHourULine.jpg"
        width={2400}
        height={1600}
        alt="Two riders laughing at a trailhead overlook at golden hour"
        loading="lazy"
      />
      <div className="lp-cta__shade" aria-hidden="true" />
      <div className="lp-container lp-cta__content">
        <h2 className="lp-cta__title">Drop in knowing your bike&apos;s dialed.</h2>
        <p className="lp-lede" style={{ maxWidth: '46ch' }}>
          Connect a platform, add the bike, and the next ride starts the count. On the web, or in
          the app for iOS and Android.
        </p>
        <div className="lp-actions">
          <Link to="/signup" className="lp-btn lp-btn--primary">
            Start free
          </Link>
          <Link to="/app" className="lp-btn lp-btn--ghost">
            Get the app
          </Link>
        </div>
        <StoreBadges />
      </div>
    </section>
  );
}
