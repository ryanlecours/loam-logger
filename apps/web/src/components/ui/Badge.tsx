// src/components/ui/Badge.tsx
import { type ReactNode, type HTMLAttributes } from 'react';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'custom';
  color?: string; // For custom variant
  icon?: ReactNode;
}

export function Badge({
  children,
  variant = 'default',
  color,
  icon,
  className = '',
  style,
  ...props
}: BadgeProps) {
  const badgeClass = variant === 'custom' ? 'badge' : `badge badge-${variant}`;
  const combinedClassName = `${badgeClass} ${className}`.trim();

  const customStyle =
    variant === 'custom' && color
      ? {
          ...style,
          backgroundColor: `${color}15`,
          color: color,
          borderColor: `${color}40`,
        }
      : style;

  return (
    <span className={combinedClassName} style={customStyle} {...props}>
      {icon && <span className="badge-icon">{icon}</span>}
      {children}
    </span>
  );
}
