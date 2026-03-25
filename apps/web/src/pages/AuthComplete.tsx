import { useEffect } from 'react';
import { useApolloClient } from '@apollo/client';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Card } from '../components/ui';
import { FaCheckCircle } from 'react-icons/fa';

export default function AuthComplete() {
  const client = useApolloClient();
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      // reload user & any cached queries that depend on it
      await client.refetchQueries({ include: 'active' }).catch(() => {});
      // short pause for UX, then go to dashboard
      setTimeout(() => navigate('/dashboard', { replace: true }), 600);
    })();
  }, [client, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-app px-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6 }}
        className="max-w-md w-full"
      >
        <Card variant="glass" className="text-center p-12">
          {/* Success Icon with Animation */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{
              duration: 0.5,
              delay: 0.2,
              type: 'spring',
              stiffness: 200,
            }}
            className="mb-6"
          >
            <FaCheckCircle className="text-6xl text-mint mx-auto" />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
          >
            <h1 className="card-title mb-2">Connected!</h1>
            <p className="body text-muted mb-6">Finishing setup…</p>

            {/* Loading spinner */}
            <div className="flex justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-mint border-t-transparent"></div>
            </div>
          </motion.div>
        </Card>
      </motion.div>
    </div>
  );
}
