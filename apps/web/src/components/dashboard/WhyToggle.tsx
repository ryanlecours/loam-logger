import { useState } from 'react';
import { FaQuestionCircle, FaChevronDown } from 'react-icons/fa';
import { motion, AnimatePresence } from 'motion/react';
import type { WearDriver } from '../../types/prediction';

interface WhyToggleProps {
  explanation: string | null;
  drivers: WearDriver[] | null;
  className?: string;
}

export function WhyToggle({ explanation, drivers, className = '' }: WhyToggleProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!explanation && (!drivers || drivers.length === 0)) {
    return null;
  }

  return (
    <div className={className}>
      <button
        className={`why-toggle ${isExpanded ? 'why-toggle-expanded' : ''}`}
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
      >
        <FaQuestionCircle size={12} />
        Why?
        <FaChevronDown size={10} className="why-toggle-chevron" />
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            className="why-panel"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            {explanation && <p className="why-panel-content">{explanation}</p>}

            {drivers && drivers.length > 0 && (
              <div className={explanation ? 'why-panel-drivers-spaced' : ''}>
                <div className="why-panel-title">Wear Factors</div>
                <div className="why-panel-drivers">
                  {drivers.map((driver) => (
                    <div key={driver.factor} className="why-driver-row">
                      <span>{driver.label}</span>
                      <span className="why-driver-value">{driver.contribution}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
