import { motion } from 'motion/react';
import MarketingButton from './MarketingButton';

export default function CTASection() {
  return (
    <section className="relative py-24 overflow-hidden">
      {/* Background with gradient overlay - Desktop */}
      <div
        className="absolute inset-0 z-0 hidden md:block"
        style={{
          backgroundImage: 'url(/mtbLandingPhoto.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundAttachment: 'fixed',
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-mkt-forest-deep/95 via-mkt-charcoal/90 to-mkt-forest-deep/95" />
      </div>

      {/* Background with gradient overlay - Mobile */}
      <div
        className="absolute inset-0 z-0 md:hidden"
        style={{
          backgroundImage: 'url(/mtbLandingPhotoMobile.jpg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-mkt-forest-deep/95 via-mkt-charcoal/90 to-mkt-forest-deep/95" />
      </div>

      {/* Content */}
      <div className="relative z-10 mkt-container">
        <motion.div
          className="max-w-4xl mx-auto text-center rounded-3xl px-8 py-12 md:px-12 md:py-16"
          style={{
            backgroundColor: 'rgba(18, 28, 24, 0.7)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(168, 208, 184, 0.1)',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(168, 208, 184, 0.05)',
          }}
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
