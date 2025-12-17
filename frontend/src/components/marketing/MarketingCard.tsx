import type { ReactNode } from 'react';
import { motion } from 'motion/react';

type Variant = 'glass' | 'solid';

type Props = {
  children: ReactNode;
  variant?: Variant;
  className?: string;
  icon?: ReactNode;
  title?: string;
  hoverEffect?: boolean;
};

export default function MarketingCard({
  children,
  variant = 'glass',
  className = '',
  icon,
  title,
  hoverEffect = true,
}: Props) {
  const baseClass = variant === 'glass' ? 'card' : 'card-solid';

  const cardContent = (
    <>
      {icon && (
        <div className="icon mb-4">
          {icon}
        </div>
      )}
      {title && (
        <h3 className="card-title mb-3">
          {title}
        </h3>
      )}
      <div className="body">
        {children}
      </div>
    </>
  );

  if (hoverEffect) {
    return (
      <motion.div
        className={`${baseClass} ${className}`}
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        whileHover={{ scale: 1.03, y: -5 }}
      >
        {cardContent}
      </motion.div>
    );
  }

  return (
    <motion.div
      className={`${baseClass} ${className}`}
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6 }}
    >
      {cardContent}
    </motion.div>
  );
}
