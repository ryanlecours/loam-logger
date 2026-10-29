import { Link, useSearchParams } from 'react-router';
import { motion } from 'motion/react';
import { TriangleAlert } from 'lucide-react';
import { Card, LinkButton } from '../components/ui';
import {
  CONNECTED_SERVICES_PATH,
  connectFailureCopy,
  parseConnectFailure,
} from '../lib/providerConnectFailure';

/**
 * Where a failed web provider connect lands.
 *
 * The four OAuth callbacks redirect here with `?message=` when the state
 * check, the token exchange or the account link fails. Before this page
 * existed the route fell through to the 404, so a rider who hit a failure
 * saw "Trail Not Found" with no way back to the connect step.
 */
export default function AuthError() {
  const [searchParams] = useSearchParams();
  const { title, body } = connectFailureCopy(parseConnectFailure(searchParams.get('message')));

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
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.5, delay: 0.2, type: 'spring', stiffness: 200 }}
            className="mb-6"
          >
            <TriangleAlert className="h-14 w-14 text-warning mx-auto" aria-hidden="true" />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
          >
            <h1 className="card-title mb-3">{title}</h1>
            {/* Masked in session replay: the copy names a provider the rider
                tried to link, which is theirs to keep. */}
            <p className="body text-muted mb-8" data-ph-mask>
              {body}
            </p>

            <div className="flex flex-col items-center gap-4">
              <LinkButton to={CONNECTED_SERVICES_PATH} size="lg">
                Try again
              </LinkButton>
              <Link to="/dashboard" className="text-sm text-muted hover:text-mint transition-colors">
                Back to dashboard
              </Link>
            </div>
          </motion.div>
        </Card>
      </motion.div>
    </div>
  );
}
