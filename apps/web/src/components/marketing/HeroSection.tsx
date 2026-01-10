import { motion } from 'motion/react';
import MarketingButton from './MarketingButton';

export default function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Background Image with Overlay - Desktop */}
      <div className="absolute inset-0 z-0 hidden md:block bg-hero-desktop bg-cover-center bg-fixed">
        <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/60 to-black/75" />
      </div>

      {/* Background Image with Overlay - Mobile */}
      <div className="absolute inset-0 z-0 md:hidden bg-hero-mobile bg-cover-center">
        <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/60 to-black/75" />
      </div>

      {/* Content */}
      <div className="relative z-10 container text-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <h1 className="hero-headline mb-6">
            Stop Guessing.<br />Start Riding Smarter.
          </h1>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
        >
          <p className="body-large text-sand max-w-3xl mx-auto mb-8">
            Track every ride. Optimize every component. Never miss a service again.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.6 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <MarketingButton href="/beta-waitlist" size="xl" pulse>
            Join the Beta Waitlist
          </MarketingButton>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.8 }}
          className="mt-6"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-mint/20 border border-mint/40 rounded-full">
            <span className="text-sm font-semibold text-mint">Free Forever for Beta Users</span>
          </div>
        </motion.div>
      </div>

      {/* Scroll Indicator */}
      <motion.div
        className="absolute bottom-8 left-1/2 transform -translate-x-1/2 z-10"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: 1,
          delay: 1.2,
          repeat: Infinity,
          repeatType: 'reverse',
        }}
      >
        <div className="w-6 h-10 border-2 border-mint/50 rounded-full flex items-start justify-center p-2">
          <div className="w-1 h-2 bg-mint rounded-full" />
        </div>
      </motion.div>
    </section>
  );
}
