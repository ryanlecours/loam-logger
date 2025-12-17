import { useEffect } from 'react';
import LandingNavbar from '../components/LandingNavbar';
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

    // Enable smooth scrolling
    document.documentElement.style.scrollBehavior = 'smooth';

    return () => {
      document.documentElement.classList.remove('marketing-page');
      document.documentElement.style.scrollBehavior = '';
    };
  }, []);

  return (
    <div className="min-h-screen" style={{ background: 'rgba(9, 9, 9, 0.95)' }}>
      <LandingNavbar />
      {/* Add padding-top to account for fixed navbar */}
      <div className="pt-16">
        <HeroSection />
        <WhatItDoesSection />
        <div id="features">
          <FeaturesSection />
        </div>
        <div id="how-it-works">
          <HowItWorksSection />
        </div>
        <div id="about">
          <AudienceSection />
          <ProblemSolutionSection />
        </div>
        <TestimonialsSection />
        <CTASection />
        <MarketingFooter />
      </div>
    </div>
  );
}
