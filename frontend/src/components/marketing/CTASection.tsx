import { motion } from 'motion/react';
import MarketingButton from './MarketingButton';

export default function CTASection() {
  return (
    <section className="relative py-24 overflow-hidden">
      {/* Background with gradient overlay */}
      <div
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: 'url(/mtbLandingPhoto.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundAttachment: 'fixed',
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-mkt-forest-deep/95 via-mkt-charcoal/90 to-mkt-forest-deep/95" />
      </div>

      {/* Content */}
      <div className="relative z-10 mkt-container text-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
        >
          <h2 className="mkt-section-title text-mkt-cream mb-6">
            Your Bike Deserves Better
          </h2>
          <p className="mkt-body-large text-mkt-sand max-w-2xl mx-auto mb-10">
            Join the waitlist now. Beta access is limited.
          </p>

          <div className="flex flex-col items-center gap-6 mb-8">
            <MarketingButton href="/beta-waitlist" size="xl" pulse>
              Join Beta Waitlist
            </MarketingButton>

            <div className="flex flex-col items-center gap-2">
              <p className="text-sm font-semibold text-mkt-mint">
                Early access rolling out soon. Limited spots.
              </p>
              <p className="text-xs text-mkt-concrete">
                No spam. Just launch updates. Unsubscribe anytime.
              </p>
            </div>
          </div>

          {/* Trust badges */}
          <div className="flex flex-wrap items-center justify-center gap-4 text-sm text-mkt-concrete">
            <div className="flex items-center gap-2">
              <span className="text-mkt-mint">✓</span>
              <span>Free Forever for Beta Users</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-mkt-mint">✓</span>
              <span>No Credit Card Required</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-mkt-mint">✓</span>
              <span>Built by Riders, for Riders</span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
