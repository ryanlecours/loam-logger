import SectionWrapper from './SectionWrapper';
import { RiCheckLine } from 'react-icons/ri';
import { motion } from 'motion/react';

const features = [
  'Track every ride automatically (Strava, Garmin, Suunto, Whoop)',
  'Monitor component wear (fork, shock, drivetrain, wheels, brakes)',
  'Get service alerts before failures',
  'Manage multiple bikes in one place',
  'Keep complete service history',
];

export default function WhatItDoesSection() {
  return (
    <SectionWrapper background="cream">
      <div className="grid lg:grid-cols-[2fr_3fr] gap-12 items-center">
        {/* Left Column: Headline + Body */}
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
        >
          <h2 className="mkt-section-title text-mkt-charcoal mb-6">
            Your Bike's Digital Logbook
          </h2>
          <p className="mkt-body mb-6">
            Stop guessing when your components need service. Loam Logger automatically tracks every ride
            and monitors wear on every part of your bike, so you know exactly when maintenance is due.
          </p>
          <a
            href="#how-it-works"
            className="inline-flex items-center text-mkt-moss font-semibold hover:text-mkt-sage transition"
          >
            See How It Works →
          </a>
        </motion.div>

        {/* Right Column: Feature List */}
        <motion.div
          initial={{ opacity: 0, x: 30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="space-y-4"
        >
          {features.map((feature, index) => (
            <div key={index} className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-1">
                <RiCheckLine size={24} className="text-mkt-mint" />
              </div>
              <p className="text-lg text-mkt-charcoal">{feature}</p>
            </div>
          ))}
        </motion.div>
      </div>
    </SectionWrapper>
  );
}
