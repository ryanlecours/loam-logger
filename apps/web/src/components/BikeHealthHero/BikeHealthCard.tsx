import { useState } from 'react';
import { motion } from 'motion/react';
import { Bike, CircleCheck, CircleAlert, TriangleAlert } from 'lucide-react';
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
  const [imageError, setImageError] = useState(false);

  return (
    <motion.div
      className="health-card"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <h3 className="health-card-bike-name">{bike.name}</h3>

      <div className="health-card-image-container">
        {bike.thumbnailUrl && !imageError ? (
          <img
            src={bike.thumbnailUrl}
            alt={bike.name}
            className="health-card-image"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="health-card-placeholder">
            <Bike className="health-card-placeholder-icon" />
          </div>
        )}
      </div>

      <div className="health-card-status">
        {bike.isHealthy ? (
          <Badge variant="success" icon={<CircleCheck />}>
            All Good
          </Badge>
        ) : (
          <>
            {bike.criticalCount > 0 && (
              <Badge variant="danger" icon={<CircleAlert />}>
                {bike.criticalCount} critical
              </Badge>
            )}
            {bike.warningCount > 0 && (
              <Badge variant="warning" icon={<TriangleAlert />}>
                {bike.warningCount} warning
              </Badge>
            )}
          </>
        )}
      </div>

      <div className="health-card-actions">
        <Button variant="secondary" size='sm' onClick={onViewDetails}>
          View Details
        </Button>
        <Button variant="outline" size='sm' onClick={onLogService}>
          Log Service
        </Button>
      </div>
    </motion.div>
  );
}
