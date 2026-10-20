import { lazy, Suspense, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ArrowDown } from 'lucide-react';
import RidgeLines from './RidgeLines';
import { detectTerrainEnvironment, shouldRenderTerrain } from './terrainGate';

const TerrainCanvas = lazy(() => import('./TerrainCanvas'));

function useTerrainEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Wait for the page to settle before paying for three.js: the photo and
    // copy are the hero, the terrain is the garnish.
    const start = () => {
      if (cancelled) return;
      setEnabled(shouldRenderTerrain(detectTerrainEnvironment()));
    };
    let idleId: number | undefined;
    let timerId: number | undefined;
    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(start, { timeout: 1500 });
    } else {
      timerId = window.setTimeout(start, 400);
    }
    return () => {
      cancelled = true;
      if (idleId !== undefined) window.cancelIdleCallback(idleId);
      if (timerId !== undefined) window.clearTimeout(timerId);
    };
  }, []);

  return enabled;
}

export default function HeroSection() {
  const terrain = useTerrainEnabled();

  return (
    <section className="lp-hero" data-testid="hero">
      <picture>
        <source media="(max-width: 767px)" srcSet="/mtbLandingPhotoMobile.jpg" />
        <img
          className="lp-hero__photo"
          src="/mtbLandingPhoto.jpg"
          alt="Rider dropping into a loamy cedar trail in the Pacific Northwest"
          fetchPriority="high"
        />
      </picture>
      <div className="lp-hero__shade" aria-hidden="true" />
      <div className="lp-hero__mist" aria-hidden="true" />
      <RidgeLines />
      {terrain && (
        <Suspense fallback={null}>
          <TerrainCanvas />
        </Suspense>
      )}

      <div className="lp-container lp-hero__content" id="top">
        <h1 className="lp-h1">
          Anyone can track a ride. <em>Loam Logger tracks your bike.</em>
        </h1>
        <p className="lp-lede">
          You already record every ride. Loam Logger takes the hours from those rides, puts them on
          the fork, the shock, the pads, the chain, whatever&apos;s on the bike, and tells you which
          ones are due.
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
    </section>
  );
}
