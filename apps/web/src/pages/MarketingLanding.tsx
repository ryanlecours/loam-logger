import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { usePageMeta } from '../hooks/usePageMeta';
import LandingNavbar from '../components/LandingNavbar';
import SiteJsonLd from '../components/marketing/SiteJsonLd';
import HeroSection from '../components/marketing/HeroSection';
import HoursSection from '../components/marketing/HoursSection';
import HowItCountsSection from '../components/marketing/HowItCountsSection';
import PhotoBandSection from '../components/marketing/PhotoBandSection';
import StraightAnswersSection from '../components/marketing/StraightAnswersSection';
import IntegrationsStrip from '../components/marketing/IntegrationsStrip';
import FreeTierSection from '../components/marketing/FreeTierSection';
import CTASection from '../components/marketing/CTASection';
import MarketingFooter from '../components/marketing/MarketingFooter';

export default function MarketingLanding() {
  usePageMeta({
    title: 'Loam Logger | Mountain bike service tracker',
    description:
      'Loam Logger takes the hours from rides you already record on Garmin Connect, Strava or WHOOP, puts them on your fork, shock, pads, chain and bearings, and tells you which parts are due. Free for one bike.',
    canonical: 'https://loamlogger.app/',
  });

  useEffect(() => {
    // Smooth in-page scrolling for the nav anchors; the CSS respects
    // prefers-reduced-motion for this class.
    document.documentElement.classList.add('marketing-page');
    return () => {
      document.documentElement.classList.remove('marketing-page');
    };
  }, []);

  // The nav and footer reach sections with client-side links like "/#how",
  // which the router does not scroll to on its own. Scroll when the hash is
  // set or changes, whether we arrived from another page or were already here.
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);

  return (
    <main className="lp">
      <SiteJsonLd />
      <LandingNavbar />
      <HeroSection />
      <HoursSection />
      <HowItCountsSection />
      <PhotoBandSection />
      <StraightAnswersSection />
      <IntegrationsStrip />
      <FreeTierSection />
      <CTASection />
      <MarketingFooter />
    </main>
  );
}
