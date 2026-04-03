import { type ReactNode } from 'react';

interface ProBadgeProps {
  children?: ReactNode;
  className?: string;
}

export function ProBadge({ children = 'PRO', className = '' }: ProBadgeProps) {
  return (
    <span
      className={`rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-400 ${className}`.trim()}
    >
      {children}
    </span>
  );
}
