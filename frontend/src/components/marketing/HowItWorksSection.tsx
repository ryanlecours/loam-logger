import { motion } from 'motion/react';
import SectionWrapper from './SectionWrapper';

const steps = [
  {
    number: '01',
    title: 'Add Your Bikes',
    description: 'Enter your bikes, add components, and set service intervals based on manufacturer recommendations or your own experience.',
  },
  {
    number: '02',
    title: 'Connect Your Rides',
    description: 'Link Strava, Garmin, or soon Suunto and Whoop. Or log rides manually. Your choice, your way.',
  },
  {
    number: '03',
    title: 'Let Us Handle the Rest',
    description: 'We track usage, send alerts when service is due, and keep your maintenance history organized. You just ride.',
  },
];

export default function HowItWorksSection() {
  return (
    <SectionWrapper background="dark">
      <div className="text-center mb-16">
        <div className="mkt-accent-bar mx-auto" />
        <h2 className="mkt-section-title text-mkt-cream mb-4">
          Three Steps. Then Ride.
        </h2>
        <p className="mkt-body text-mkt-concrete max-w-2xl mx-auto">
          Getting started is simple. No complexity, no learning curve.
        </p>
      </div>

      {/* Desktop: Horizontal Timeline */}
      <div className="hidden lg:block">
        <div className="relative">
          {/* Connecting Line */}
          <div className="absolute top-16 left-0 right-0 h-1 bg-gradient-to-r from-mkt-sage via-mkt-mint to-mkt-sage" />

          <div className="grid grid-cols-3 gap-8 relative">
            {steps.map((step, index) => (
              <motion.div
                key={index}
                className="text-center"
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: index * 0.2 }}
              >
                {/* Number Circle */}
                <div className="relative mx-auto w-32 h-32 mb-6 flex items-center justify-center">
                  <div className="absolute inset-0 rounded-full bg-gradient-to-br from-mkt-sage to-mkt-moss border-4 border-mkt-mint/30" />
                  <span className="relative text-4xl font-bold text-mkt-cream">
                    {step.number}
                  </span>
                </div>

                <h3 className="mkt-card-title text-mkt-cream mb-3">
                  {step.title}
                </h3>
                <p className="mkt-body text-mkt-concrete">
                  {step.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      {/* Mobile/Tablet: Vertical Timeline */}
      <div className="lg:hidden space-y-8">
        {steps.map((step, index) => (
          <motion.div
            key={index}
            className="flex gap-6"
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: index * 0.15 }}
          >
            {/* Number Circle */}
            <div className="flex-shrink-0">
              <div className="relative w-20 h-20 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-mkt-sage to-mkt-moss border-4 border-mkt-mint/30" />
                <span className="relative text-2xl font-bold text-mkt-cream">
                  {step.number}
                </span>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 pt-2">
              <h3 className="mkt-card-title text-mkt-cream mb-2">
                {step.title}
              </h3>
              <p className="mkt-body text-mkt-concrete">
                {step.description}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </SectionWrapper>
  );
}
