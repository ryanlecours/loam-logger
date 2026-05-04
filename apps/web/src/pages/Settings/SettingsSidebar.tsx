import { useEffect, useRef } from 'react';
import {
  User,
  Link as LinkIcon,
  Sliders,
  Wrench,
  Activity,
  Shield,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react';
import type { SettingsSectionId } from './useSettingsSection';

type SettingsSectionMeta = {
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
};

const SETTINGS_SECTIONS: readonly SettingsSectionMeta[] = [
  { id: 'account', label: 'Account', icon: User },
  { id: 'data-sources', label: 'Data Sources', icon: LinkIcon },
  { id: 'preferences', label: 'Preferences', icon: Sliders },
  { id: 'service-intervals', label: 'Service Intervals', icon: Wrench },
  { id: 'maintenance', label: 'Maintenance', icon: Activity },
  { id: 'privacy', label: 'Privacy', icon: Shield },
  { id: 'danger', label: 'Danger Zone', icon: AlertTriangle },
];

type Props = {
  activeId: SettingsSectionId;
  onSelect: (id: SettingsSectionId) => void;
};

export default function SettingsSidebar({ activeId, onSelect }: Props) {
  const mobileListRef = useRef<HTMLDivElement | null>(null);

  // Scroll active pill into view on mobile when section changes.
  useEffect(() => {
    const root = mobileListRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLButtonElement>(`[data-section-id="${activeId}"]`);
    if (el) {
      el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }
  }, [activeId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = SETTINGS_SECTIONS.findIndex((s) => s.id === activeId);
    if (currentIndex < 0) return;

    let nextIndex = currentIndex;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % SETTINGS_SECTIONS.length;
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length;
    } else if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = SETTINGS_SECTIONS.length - 1;
    } else {
      return;
    }

    e.preventDefault();
    onSelect(SETTINGS_SECTIONS[nextIndex].id);
  };

  return (
    <>
      {/* Desktop: vertical sticky sidebar */}
      {/*
        Desktop and mobile sidebars are both rendered into the DOM at all
        times — only their `display` toggles via the Tailwind `hidden /
        md:block` classes. That means the buttons' `id` attributes have to
        be distinct between the two trees ('settings-tab-desktop-…' vs
        'settings-tab-mobile-…'). Sharing one id across both branches would
        produce duplicate ids in the DOM, which invalidates HTML and breaks
        aria-controls / aria-labelledby — `getElementById` would return
        whichever button appears first in source order, regardless of which
        viewport the user is actually on. The matching panel in
        SettingsShell.tsx references both ids via `aria-labelledby` so the
        visible-to-AT button is always the one ATs read.
      */}
      <aside
        className="hidden md:block md:sticky md:self-start"
        style={{ top: 'calc(4rem + 1.5rem)' }}
      >
        <div
          role="tablist"
          aria-orientation="vertical"
          aria-label="Settings sections"
          onKeyDown={handleKeyDown}
          className="flex flex-col gap-1"
        >
          {SETTINGS_SECTIONS.map(({ id, label, icon: Icon }) => {
            const isActive = id === activeId;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`settings-panel-${id}`}
                id={`settings-tab-desktop-${id}`}
                tabIndex={isActive ? 0 : -1}
                data-section-id={id}
                onClick={() => onSelect(id)}
                className={[
                  'group flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition',
                  'border border-transparent',
                  isActive
                    ? 'bg-surface-2 border-app/70 text-white shadow-[inset_0_0_0_1px_rgba(156,176,164,0.18)]'
                    : 'text-muted hover:bg-surface-2/60 hover:text-white/90 hover:border-app/50',
                ].join(' ')}
              >
                <Icon
                  className={[
                    'h-4 w-4 shrink-0 transition',
                    isActive ? 'text-[color:var(--mint)]' : 'text-muted group-hover:text-white/80',
                  ].join(' ')}
                />
                <span className="font-medium">{label}</span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Mobile: horizontal scroll of pills */}
      <div className="md:hidden -mx-4 px-4">
        <div
          ref={mobileListRef}
          role="tablist"
          aria-orientation="horizontal"
          aria-label="Settings sections"
          onKeyDown={handleKeyDown}
          className="flex gap-2 overflow-x-auto pb-1 scrollbar-none"
          style={{ scrollbarWidth: 'none' }}
        >
          {SETTINGS_SECTIONS.map(({ id, label, icon: Icon }) => {
            const isActive = id === activeId;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`settings-panel-${id}`}
                id={`settings-tab-mobile-${id}`}
                tabIndex={isActive ? 0 : -1}
                data-section-id={id}
                onClick={() => onSelect(id)}
                className={[
                  'inline-flex shrink-0 items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium transition',
                  'border',
                  isActive
                    ? 'bg-surface-2 border-app text-white'
                    : 'bg-transparent border-app/50 text-muted hover:text-white/90',
                ].join(' ')}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
