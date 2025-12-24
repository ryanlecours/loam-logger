import { motion } from 'motion/react';
import { Card } from '../components/ui';
import MarketingButton from '../components/marketing/MarketingButton';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-app px-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6 }}
        className="max-w-md w-full"
      >
        <Card variant="glass" className="text-center p-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <h1 className="text-8xl font-bold text-mint mb-4">404</h1>
            <h2 className="section-title mb-4">Trail Not Found</h2>
            <p className="body text-muted mb-8">
              Looks like you've wandered off the trail. Let's get you back on track.
            </p>
            <MarketingButton href="/" size="md">
              Return Home
            </MarketingButton>
          </motion.div>
        </Card>
      </motion.div>
    </div>
  );
}