import SectionWrapper from './SectionWrapper';
import MarketingCard from './MarketingCard';
import {
  RiBikeLine,
  RiSettings4Line,
  RiHistoryLine,
  RiBellLine,
  RiBarChartLine,
  RiCloudLine
} from 'react-icons/ri';

const features = [
  {
    icon: <RiBikeLine size={36} />,
    title: 'Multi-Bike Management',
    description: 'Track your entire quiver in one place. From XC whips to downhill sleds, manage every bike with ease.',
  },
  {
    icon: <RiSettings4Line size={36} />,
    title: 'Component-Level Tracking',
    description: 'Monitor fork, shock, drivetrain, wheels, and brakes independently. Know exactly what needs attention.',
  },
  {
    icon: <RiHistoryLine size={36} />,
    title: 'Complete Service History',
    description: 'Document every service with notes and dates. Never wonder when you last rebuilt that shock.',
  },
  {
    icon: <RiBellLine size={36} />,
    title: 'Smart Alerts',
    description: 'Get notified based on time and distance. Customizable intervals for each component type.',
  },
  {
    icon: <RiBarChartLine size={36} />,
    title: 'Ride Statistics',
    description: 'See your riding trends and component usage patterns. Make data-driven maintenance decisions.',
  },
  {
    icon: <RiCloudLine size={36} />,
    title: 'Auto-Sync Everything',
    description: 'Connect Strava, Garmin, and soon Suunto and Whoop. Your rides sync automatically.',
  },
];

export default function FeaturesSection() {
  return (
    <SectionWrapper background="gradient-dark">
      <div className="text-center mb-12">
        <div className="mkt-accent-bar mx-auto" />
        <h2 className="mkt-section-title text-mkt-cream mb-4">
          Everything You Need. Nothing You Don't.
        </h2>
        <p className="mkt-body text-mkt-concrete max-w-2xl mx-auto">
          Comprehensive bike and component tracking designed specifically for mountain bikers.
        </p>
      </div>

      {/* Bento Box Grid Layout */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Row 1: Large card (2 cols) + Small card (1 col) */}
        <div className="md:col-span-2">
          <MarketingCard
            variant="glass"
            icon={features[0].icon}
            title={features[0].title}
            className="h-full"
          >
            {features[0].description}
          </MarketingCard>
        </div>
        <MarketingCard
          variant="glass"
          icon={features[1].icon}
          title={features[1].title}
          className="h-full"
        >
          {features[1].description}
        </MarketingCard>

        {/* Row 2: Three small cards */}
        {features.slice(2).map((feature, index) => (
          <MarketingCard
            key={index + 2}
            variant="glass"
            icon={feature.icon}
            title={feature.title}
            className="h-full"
          >
            {feature.description}
          </MarketingCard>
        ))}
      </div>
    </SectionWrapper>
  );
}
