import { Link } from 'react-router';

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
          Connect a platform, add the bike, and the next ride starts the count.
        </p>
        <div className="lp-actions">
          <Link to="/signup" className="lp-btn lp-btn--primary">
            Start free
          </Link>
          <a
            href="https://apps.apple.com/us/app/loam-logger/id6761736134"
            className="lp-btn lp-btn--ghost"
            target="_blank"
            rel="noopener noreferrer"
          >
            iOS app<span className="sr-only"> (opens the App Store in a new tab)</span>
          </a>
        </div>
      </div>
    </section>
  );
}
