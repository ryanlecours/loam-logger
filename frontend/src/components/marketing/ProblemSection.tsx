import SectionWrapper from './SectionWrapper';
import MarketingCard from './MarketingCard';
import { RiAlertFill, RiLinksLine, RiQuestionMark } from 'react-icons/ri';

const problems = [
  {
    icon: <RiAlertFill size={40} />,
    title: 'Blown Shock. Mid-Ride.',
    description: 'Overdue service costs you money and riding time. That fork rebuild you forgot about? Now it\'s a costly repair instead of routine maintenance.',
  },
  {
    icon: <RiLinksLine size={40} />,
    title: 'Forgotten Chain. Snapped.',
    description: 'Lost track of wear, now you\'re walking. You meant to replace it after that last shuttle day, but you forgot. Now you\'re miles from the trailhead.',
  },
  {
    icon: <RiQuestionMark size={40} />,
    title: 'Component Lottery',
    description: 'Your gear history is a mystery. Which shock was on which bike? When did you swap those wheels? Spreadsheets feel like work, not riding.',
  },
];

export default function ProblemSection() {
  return (
    <SectionWrapper background="charcoal" className="texture-loam">
      <div className="text-center mb-12">
        <div className="accent-bar mx-auto" />
        <h2 className="section-title text-cream mb-4">
          You Know the Drill
        </h2>
        <p className="body text-concrete max-w-2xl mx-auto">
          Every rider has been there. The preventable mechanical. The forgotten service interval. The guesswork.
        </p>
      </div>

      <div className="grid-3">
        {problems.map((problem, index) => (
          <MarketingCard
            key={index}
            variant="glass"
            icon={problem.icon}
            title={problem.title}
          >
            {problem.description}
          </MarketingCard>
        ))}
      </div>
    </SectionWrapper>
  );
}
