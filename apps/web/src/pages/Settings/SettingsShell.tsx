import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';
import SettingsSidebar from './SettingsSidebar';
import { useSettingsSection, type SettingsSectionId } from './useSettingsSection';

type Props = {
  children: (section: SettingsSectionId) => ReactNode;
};

export default function SettingsShell({ children }: Props) {
  const { section, setSection } = useSettingsSection();
  const reduceMotion = useReducedMotion();

  return (
    <div className="page-container">
      <div
        className="grid gap-6 md:gap-8 md:grid-cols-[220px_minmax(0,1fr)]"
      >
        <SettingsSidebar activeId={section} onSelect={setSection} />

        <div className="min-w-0">
          <AnimatePresence mode="wait" initial={false}>
            <motion.section
              key={section}
              id={`settings-panel-${section}`}
              role="tabpanel"
              aria-labelledby={`settings-tab-${section}`}
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
