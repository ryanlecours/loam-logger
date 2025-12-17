import SectionWrapper from './SectionWrapper';
import { RiUserHeartLine, RiToolsLine, RiCarLine } from 'react-icons/ri';

const personas = [
  {
    icon: <RiUserHeartLine size={40} />,
    title: 'The Weekend Warrior',
    description: 'You ride hard every chance you get. You want your bike dialed without spending hours on spreadsheets. Just tell you what needs attention and when.',
  },
  {
    icon: <RiToolsLine size={40} />,
    title: 'The Gear Head',
    description: 'Multiple bikes. Component swaps. Constant tinkering. You need to track it all without losing your mind. Know what\'s on which bike and when it needs service.',
  },
  {
    icon: <RiCarLine size={40} />,
    title: 'The Shuttle Chaser',
    description: 'Big days mean big wear. You maximize every ride and want to maximize component life too. Get the most out of your gear without surprise failures.',
  },
];

export default function AudienceSection() {
  return (
    <SectionWrapper background="cream" className="!py-16">
      <div className="text-center mb-8">
        <h3 className="text-xl font-semibold text-mkt-charcoal mb-2">
          Built For You If...
        </h3>
      </div>

      {/* Horizontal Scroll Container */}
      <div className="overflow-x-auto pb-4 -mx-4 px-4 md:overflow-visible">
        <div className="flex md:grid md:grid-cols-3 gap-4 min-w-max md:min-w-0">
          {personas.map((persona, index) => (
            <div
              key={index}
              className="w-80 md:w-auto flex-shrink-0 bg-mkt-charcoal border border-mkt-slate/30 rounded-xl p-5 transition-transform hover:scale-105"
            >
              <div className="text-mkt-mint mb-3">
                {persona.icon}
              </div>
              <h4 className="text-lg font-semibold text-mkt-cream mb-2">
                {persona.title}
              </h4>
              <p className="text-sm text-mkt-concrete leading-relaxed">
                {persona.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </SectionWrapper>
  );
}
