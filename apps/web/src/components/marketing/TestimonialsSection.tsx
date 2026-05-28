import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import SectionWrapper from './SectionWrapper';

export default function TestimonialsSection() {
  const [userCount, setUserCount] = useState<number | null>(null);
  const [ridesTracked, setRidesTracked] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.VITE_API_URL}/api/public/stats`, { signal: controller.signal })
      .then((res) => res.ok ? res.json() : Promise.reject())
      .then((json) => {
        if (typeof json.userCount === 'number') setUserCount(json.userCount);
        if (typeof json.ridesTracked === 'number') setRidesTracked(json.ridesTracked);
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') console.error('[Stats] fetch failed', err);
      });
    return () => controller.abort();
  }, []);

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
              <div className="text-5xl font-bold text-mint mb-2">
                {userCount !== null ? userCount.toLocaleString() : <span className="opacity-40">—</span>}
              </div>
              <p className="text-sm text-concrete uppercase tracking-wider">
                Riders
              </p>
            </div>
            <div className="text-center">
              <div className="text-5xl font-bold text-mint mb-2">
                {ridesTracked !== null ? ridesTracked.toLocaleString() : <span className="opacity-40">—</span>}
              </div>
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

          {/* Community Note */}
          <div className="p-6 bg-moss/20 border border-moss/40 rounded-2xl">
            <p className="body text-sand">
              Riders are putting Loam Logger through its paces on trails across the world.
              Sign up to join them and take the guesswork out of bike maintenance tracking.
            </p>
          </div>
        </motion.div>
      </div>
    </SectionWrapper>
  );
}
