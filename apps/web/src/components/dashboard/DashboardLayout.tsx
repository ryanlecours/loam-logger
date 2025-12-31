import type { ReactNode } from 'react';

interface DashboardLayoutProps {
  /** Main content area (hero + switcher) */
  main: ReactNode;
  /** Sidebar content (rides + stats) */
  sidebar: ReactNode;
  /** Optional className override */
  className?: string;
}

/**
 * Control room layout for the dashboard.
 * Desktop: 2-column grid, viewport-locked (no page scroll)
 * Tablet/Mobile: Single column, allows page scroll
 */
export function DashboardLayout({ main, sidebar, className = '' }: DashboardLayoutProps) {
  return (
    <div className={`control-room ${className}`.trim()}>
      <div className="control-room-main">{main}</div>
      <aside className="control-room-sidebar">{sidebar}</aside>
    </div>
  );
}
