import { Navigate } from 'react-router-dom';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import AdminShell from './AdminShell';
import { OverviewSection } from './sections/OverviewSection';
import { UsersSection } from './sections/UsersSection';
import { WaitlistSection } from './sections/WaitlistSection';
import { EmailSection } from './sections/EmailSection';
import type { AdminSectionId } from './useAdminSection';

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
    <AdminShell>
      {(section: AdminSectionId) => {
        switch (section) {
          case 'overview':
            return <OverviewSection />;
          case 'users':
            return <UsersSection />;
          case 'waitlist':
            return <WaitlistSection />;
          case 'email':
            return <EmailSection />;
        }
      }}
    </AdminShell>
  );
}
