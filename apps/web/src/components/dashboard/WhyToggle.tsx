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
        <FaChevronDown
          size={10}
          style={{
            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease',
          }}
        />
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
            {explanation && <p style={{ margin: 0 }}>{explanation}</p>}

            {drivers && drivers.length > 0 && (
              <div style={{ marginTop: explanation ? '0.75rem' : 0 }}>
                <div className="why-panel-title">Wear Factors</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {drivers.map((driver) => (
                    <div
                      key={driver.factor}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '0.5rem',
                      }}
                    >
                      <span>{driver.label}</span>
                      <span
                        style={{
                          fontWeight: 600,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {driver.contribution}%
                      </span>
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
