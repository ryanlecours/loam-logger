import type { ReactNode } from 'react';
import { Link } from 'react-router';

type Size = 'sm' | 'md' | 'lg' | 'xl';
type Variant = 'primary' | 'secondary';

type Props = {
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  size?: Size;
  variant?: Variant;
  pulse?: boolean;
  className?: string;
};

const sizeClasses: Record<Size, string> = {
  sm: 'text-sm px-4 py-2',
  md: 'text-base px-6 py-3',
  lg: 'text-lg px-8 py-4',
  xl: 'mkt-cta-text px-12 py-5',
};

export default function MarketingButton({
  children,
  href,
  onClick,
  size = 'lg',
  variant = 'primary',
  pulse = false,
  className = '',
}: Props) {
  const baseClass = variant === 'primary' ? 'mkt-btn-primary' : 'mkt-btn-secondary';
  const pulseClass = pulse ? 'mkt-btn-pulse' : '';
  const classes = `${baseClass} ${sizeClasses[size]} ${pulseClass} ${className}`;

  if (href) {
    return (
      <Link to={href} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button onClick={onClick} className={classes}>
      {children}
    </button>
  );
}
