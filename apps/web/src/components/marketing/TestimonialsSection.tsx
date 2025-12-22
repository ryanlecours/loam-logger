import { motion } from 'motion/react';
import SectionWrapper from './SectionWrapper';

export default function TestimonialsSection() {
  return (
    <SectionWrapper background="charcoal">
      <div className="text-center max-w-4xl mx-auto">
        <div className="accent-bar mx-auto mb-8" />

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
        >
          <h2 className="section-title text-cream mb-6">
            Riders Who Get It
          </h2>

          {/* Stats Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
            <div className="text-center">
              <div className="text-5xl font-bold text-mint mb-2">300+</div>
              <p className="text-sm text-concrete uppercase tracking-wider">
                Beta Waitlist
              </p>
            </div>
            <div className="text-center">
              <div className="text-5xl font-bold text-mint mb-2">∞</div>
              <p className="text-sm text-concrete uppercase tracking-wider">
                Rides Tracked
              </p>
            </div>
            <div className="text-center">
              <div className="text-5xl font-bold text-mint mb-2">100%</div>
              <p className="text-sm text-concrete uppercase tracking-wider">
                Made for Riders
              </p>
            </div>
          </div>

          {/* Beta Note */}
          <div className="p-6 bg-moss/20 border border-moss/40 rounded-2xl">
            <p className="body text-sand">
              Early beta testers are putting Loam Logger through its paces on trails across the world.
              Join the waitlist to be part of the next wave of riders testing the future of bike maintenance tracking.
            </p>
          </div>
        </motion.div>
      </div>
    </SectionWrapper>
  );
}
