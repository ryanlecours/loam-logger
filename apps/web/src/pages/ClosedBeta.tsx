import { useEffect } from 'react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import MarketingButton from '../components/marketing/MarketingButton';

export default function ClosedBeta() {
  const navigate = useNavigate();

  useEffect(() => {
    document.documentElement.classList.add('marketing-page');
    return () => {
      document.documentElement.classList.remove('marketing-page');
    };
  }, []);

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-dark">
      {/* Background Image with Overlay - Desktop */}
      <div className="absolute inset-0 z-0 hidden md:block bg-hero-desktop bg-cover-center bg-fixed">
        <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/60 to-black/75" />
      </div>

      {/* Background Image with Overlay - Mobile */}
      <div className="absolute inset-0 z-0 md:hidden bg-hero-mobile bg-cover-center">
        <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/60 to-black/75" />
      </div>

      {/* Content */}
      <motion.div
        className="relative z-10 container text-center px-6 max-w-2xl"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
      >
        <div className="text-7xl mb-6">🔒</div>
        <h1 className="hero-headline mb-6">Closed Beta</h1>
        <p className="body-large text-sand mb-4">
          Loam Logger is currently in closed beta testing. We're working hard to make the app amazing before opening it up to everyone.
        </p>

        <div className="info-panel mb-8">
          <p className="body text-concrete">
            Want early access? Join our waitlist and we'll email you when a spot opens up.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <MarketingButton href="/beta-waitlist" size="lg">
            Join the Waitlist
          </MarketingButton>
          <button
            onClick={() => navigate(-1)}
            className="btn-secondary text-lg px-8 py-4"
          >
            Go Back
          </button>
        </div>
      </motion.div>
    </section>
  );
}
