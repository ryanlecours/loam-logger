import { Navigate } from 'react-router-dom';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import AdminShell from './AdminShell';
import { OverviewSection } from './sections/OverviewSection';
import { UsersSection } from './sections/UsersSection';
import { EmailSection } from './sections/EmailSection';
import type { AdminSectionId } from './useAdminSection';
import { AdminStatsProvider } from './AdminStatsProvider';

/**
 * Admin page entry point. Mounts the sectioned shell; the role gate lives
 * here (rather than per-section) so each section can assume the caller is
 * already an ADMIN. Routed from App.tsx via `import Admin from './pages/Admin';`
 * which resolves through this file once the legacy `Admin.tsx` is removed.
 */
export default function Admin() {
  const { user, loading } = useCurrentUser();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div
          className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
          role="status"
          aria-label="Loading"
        />
      </div>
    );
  }

  if (user?.role !== 'ADMIN') {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    // Stats provider wraps the whole admin tree so any section's mutation
    // handlers can call `refresh()` to keep the Overview counters fresh
    // — even when the admin is on a different tab during the mutation.
    // Lives at this level so the stats survive section-tab transitions
    // (each section unmounts via AnimatePresence's mode="wait", so a
    // section-local store would lose data on every navigation).
    <AdminStatsProvider>
      <AdminShell>
        {(section: AdminSectionId) => {
          switch (section) {
            case 'overview':
              return <OverviewSection />;
            case 'users':
              return <UsersSection />;
            case 'email':
              return <EmailSection />;
          }
        }}
      </AdminShell>
    </AdminStatsProvider>
  );
}
