import { motion } from 'motion/react';
import SectionWrapper from './SectionWrapper';
import { RiArrowRightLine } from 'react-icons/ri';

const problemSolutions = [
  {
    problem: 'Forgotten service → Blown shock mid-ride 💸',
    solution: 'Auto-alerts track hours & miles → Remind before failure',
  },
  {
    problem: 'Spreadsheet chaos → Can\'t remember what\'s on which bike',
    solution: 'Digital logbook → Complete history, all bikes, one place',
  },
  {
    problem: 'Guessing when to service → Premature wear or failure',
    solution: 'Smart intervals → Optimize component life',
  },
];

export default function ProblemSolutionSection() {
  return (
    <SectionWrapper background="light">
      <div className="text-center mb-12">
        <div className="accent-bar mx-auto" />
        <h2 className="section-title text-charcoal mb-4">
          No More Guesswork
        </h2>
      </div>

      {/* Alternating Rows */}
      <div className="max-w-4xl mx-auto space-y-6">
        {problemSolutions.map((item, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: index * 0.1 }}
            className="grid md:grid-cols-[1fr_auto_1fr] gap-4 items-center"
          >
            {/* Problem (Left) */}
            <div className="bg-sand/50 border border-red-600/20 rounded-lg p-4">
              <p className="text-sm font-medium text-charcoal opacity-75">
                {item.problem}
              </p>
            </div>

            {/* Arrow */}
            <div className="hidden md:flex justify-center">
              <RiArrowRightLine size={24} className="text-moss" />
            </div>

            {/* Solution (Right) */}
            <div className="bg-charcoal border border-mint/30 rounded-lg p-4">
              <p className="text-sm font-medium text-cream">
                {item.solution}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </SectionWrapper>
  );
}
