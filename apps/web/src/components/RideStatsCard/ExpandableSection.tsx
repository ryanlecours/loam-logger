import { useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FaChevronDown } from 'react-icons/fa';

interface ExpandableSectionProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  defaultExpanded?: boolean;
  children: ReactNode;
  isEmpty?: boolean;
  emptyMessage?: string;
}

export default function ExpandableSection({
  title,
  subtitle,
  icon,
  defaultExpanded = false,
  children,
  isEmpty = false,
  emptyMessage = 'No data available',
}: ExpandableSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className="expandable-section">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="expandable-header"
      >
        <div className="expandable-header-left">
          {icon && <span className="section-icon">{icon}</span>}
          <span className="section-title">{title}</span>
          {subtitle && <span className="section-subtitle">{subtitle}</span>}
        </div>
        <motion.span
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.25, ease: 'easeInOut' }}
          className="chevron-icon"
        >
          <FaChevronDown size={12} />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="expandable-content-wrapper"
          >
            <div className="expandable-content">
              {isEmpty ? (
                <p className="section-empty">{emptyMessage}</p>
              ) : (
                children
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
