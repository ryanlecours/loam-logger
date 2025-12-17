import SectionWrapper from './SectionWrapper';
import MarketingCard from './MarketingCard';
import { RiBellFill, RiRefreshLine, RiBookOpenFill } from 'react-icons/ri';

const solutions = [
  {
    icon: <RiBellFill size={40} />,
    title: 'Automatic Service Alerts',
    description: 'Track hours and miles on every component. Get reminders before things break. No more guessing when your shock service is due.',
  },
  {
    icon: <RiRefreshLine size={40} />,
    title: 'Set It and Forget It',
    description: 'Auto-sync with Strava, Garmin, and soon Suunto and Whoop. Your rides automatically update component usage. You just ride.',
  },
  {
    icon: <RiBookOpenFill size={40} />,
    title: 'Complete Bike History',
    description: 'Full quiver management with component-level tracking. Know exactly what\'s on each bike, when it was installed, and when it needs attention.',
  },
];

export default function SolutionSection() {
  return (
    <SectionWrapper background="light">
      <div className="text-center mb-12">
        <div className="mkt-accent-bar mx-auto" />
        <h2 className="mkt-section-title text-mkt-charcoal mb-4">
          Built by Riders, for Riders
        </h2>
        <p className="mkt-body max-w-2xl mx-auto">
          We got sick of guessing too. So we built the tool that doesn't exist.
        </p>
      </div>

      <div className="mkt-grid-3">
        {solutions.map((solution, index) => (
          <MarketingCard
            key={index}
            variant="solid"
            icon={solution.icon}
            title={solution.title}
          >
            {solution.description}
          </MarketingCard>
        ))}
      </div>
    </SectionWrapper>
  );
}
