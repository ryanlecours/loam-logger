import { useEffect } from 'react';
import { usePageMeta } from '../hooks/usePageMeta';
import LandingNavbar from '../components/LandingNavbar';
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

  return (
    <main className="lp">
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
