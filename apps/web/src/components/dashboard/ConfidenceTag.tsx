import type { ConfidenceLevel } from '../../types/prediction';
import { CONFIDENCE_CONFIG } from '../../types/prediction';

interface ConfidenceTagProps {
  level: ConfidenceLevel;
  className?: string;
}

const CONFIDENCE_CLASSES: Record<ConfidenceLevel, string> = {
  HIGH: 'confidence-tag-high',
  MEDIUM: 'confidence-tag-medium',
  LOW: 'confidence-tag-low',
};

export function ConfidenceTag({ level, className = '' }: ConfidenceTagProps) {
  const config = CONFIDENCE_CONFIG[level];
  const levelClass = CONFIDENCE_CLASSES[level];

  return (
    <span className={`confidence-tag ${levelClass} ${className}`.trim()}>
      {config.label}
    </span>
  );
}
