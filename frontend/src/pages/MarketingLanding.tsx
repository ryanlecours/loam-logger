import { useEffect } from 'react';
import HeroSection from '../components/marketing/HeroSection';
import WhatItDoesSection from '../components/marketing/WhatItDoesSection';
import HowItWorksSection from '../components/marketing/HowItWorksSection';
import FeaturesSection from '../components/marketing/FeaturesSection';
import AudienceSection from '../components/marketing/AudienceSection';
import ProblemSolutionSection from '../components/marketing/ProblemSolutionSection';
import TestimonialsSection from '../components/marketing/TestimonialsSection';
import CTASection from '../components/marketing/CTASection';
import MarketingFooter from '../components/marketing/MarketingFooter';
import '../styles/marketing.css';

export default function MarketingLanding() {
  useEffect(() => {
    // Add marketing-page class to html element for smooth scrolling
    document.documentElement.classList.add('marketing-page');

    return () => {
      document.documentElement.classList.remove('marketing-page');
    };
  }, []);

  return (
    <div className="min-h-screen">
      <HeroSection />
      <WhatItDoesSection />
      <div id="how-it-works">
        <HowItWorksSection />
      </div>
      <FeaturesSection />
      <AudienceSection />
      <ProblemSolutionSection />
      <TestimonialsSection />
      <CTASection />
      <MarketingFooter />
    </div>
  );
}
