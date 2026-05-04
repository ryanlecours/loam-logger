import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';
import AdminSidebar from './AdminSidebar';
import { useAdminSection, type AdminSectionId } from './useAdminSection';

type Props = {
  children: (section: AdminSectionId) => ReactNode;
};

/**
 * Sidebar + animated panel shell for the admin page. Mirrors the Settings
 * shell pattern (apps/web/src/pages/Settings/SettingsShell.tsx) so the
 * admin page reads as a familiar sibling to Settings — a sectioned tool
 * surface, not a 2,000-line scroll wall.
 */
export default function AdminShell({ children }: Props) {
  const { section, setSection } = useAdminSection();
  const reduceMotion = useReducedMotion();

  return (
    <div className="page-container">
      <div className="grid gap-6 md:gap-8 md:grid-cols-[220px_minmax(0,1fr)]">
        <AdminSidebar activeId={section} onSelect={setSection} />

        <div className="min-w-0">
          <AnimatePresence mode="wait" initial={false}>
            <motion.section
              key={section}
              id={`admin-panel-${section}`}
              role="tabpanel"
              aria-labelledby={`admin-tab-${section}`}
              tabIndex={0}
              initial={{ opacity: 0, y: reduceMotion ? 0 : 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduceMotion ? 0 : -6 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="space-y-6 focus:outline-none"
            >
              {children(section)}
            </motion.section>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
