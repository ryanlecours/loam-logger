import { motion } from 'motion/react';
import { FaCheckCircle, FaExclamationCircle, FaExclamationTriangle } from 'react-icons/fa';
import { Badge, Button } from '../ui';
import type { BikeHealth } from '../../utils/transformToHealthData';

interface BikeHealthCardProps {
  bike: BikeHealth;
  onViewDetails: () => void;
  onLogService: () => void;
}

export function BikeHealthCard({
  bike,
  onViewDetails,
  onLogService,
}: BikeHealthCardProps) {
  return (
    <motion.div
      className="health-card"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      whileHover={{ y: -4 }}
    >
      <h3 className="health-card-bike-name">{bike.name}</h3>

      <div className="health-card-status">
        {bike.isHealthy ? (
          <Badge variant="success" icon={<FaCheckCircle />}>
            All Good
          </Badge>
        ) : (
          <>
            {bike.criticalCount > 0 && (
              <Badge variant="danger" icon={<FaExclamationCircle />}>
                {bike.criticalCount} critical
              </Badge>
            )}
            {bike.warningCount > 0 && (
              <Badge variant="warning" icon={<FaExclamationTriangle />}>
                {bike.warningCount} warning
              </Badge>
            )}
          </>
        )}
      </div>

      <div className="health-card-actions">
        <Button variant="secondary" onClick={onViewDetails}>
          View Details
        </Button>
        <Button variant="outline" onClick={onLogService}>
          Log Service
        </Button>
      </div>
    </motion.div>
  );
}
