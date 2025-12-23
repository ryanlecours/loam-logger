// src/components/ui/Card.tsx
import { type ReactNode } from 'react';
import { motion, type HTMLMotionProps } from 'motion/react';

type CardProps = {
  children: ReactNode;
  variant?: 'glass' | 'solid' | 'elevated' | 'flat';
  hover?: boolean;
  className?: string;
} & Omit<HTMLMotionProps<'div'>, 'children'>;

export function Card({
  children,
  variant = 'glass',
  hover = false,
  className = '',
  ...props
}: CardProps) {
  // Map variant to existing marketing.css classes
  const variantClasses = {
    glass: 'card',
    solid: 'card-solid',
    elevated: 'modal-surface', // For modals - elevated glass with stronger shadow
    flat: 'bg-surface border border-app rounded-xl', // Minimal card for nested elements
  };

  const baseClass = variantClasses[variant];
  const combinedClassName = `${baseClass} ${className}`.trim();

  return (
    <motion.div
      className={combinedClassName}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6 }}
      whileHover={hover ? { y: -5 } : undefined}
      {...props}
    >
      {children}
    </motion.div>
  );
}
