import { useEffect } from 'react';
import LandingNavbar from '../components/LandingNavbar';
import HeroSection from '../components/marketing/HeroSection';
import HoursSection from '../components/marketing/HoursSection';
import HowItCountsSection from '../components/marketing/HowItCountsSection';
import PhotoBandSection from '../components/marketing/PhotoBandSection';
import StraightAnswersSection from '../components/marketing/StraightAnswersSection';
import IntegrationsStrip from '../components/marketing/IntegrationsStrip';
import PricingSection from '../components/marketing/PricingSection';
import CTASection from '../components/marketing/CTASection';
import MarketingFooter from '../components/marketing/MarketingFooter';

export default function MarketingLanding() {
  useEffect(() => {
    // Smooth in-page scrolling for the nav anchors; the CSS respects
    // prefers-reduced-motion for this class.
    document.documentElement.classList.add('marketing-page');
    return () => {
      document.documentElement.classList.remove('marketing-page');
    };
  }, []);

  return (
    <div className="lp">
      <LandingNavbar />
      <HeroSection />
      <HoursSection />
      <HowItCountsSection />
      <PhotoBandSection />
      <StraightAnswersSection />
      <IntegrationsStrip />
      <PricingSection />
      <CTASection />
      <MarketingFooter />
    </div>
  );
}
