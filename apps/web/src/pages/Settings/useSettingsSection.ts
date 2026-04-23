import { useSearchParams } from 'react-router-dom';
import { useCallback, useMemo } from 'react';

export type SettingsSectionId =
  | 'account'
  | 'data-sources'
  | 'preferences'
  | 'service-intervals'
  | 'maintenance'
  | 'privacy'
  | 'danger';

const KNOWN_SECTIONS: readonly SettingsSectionId[] = [
  'account',
  'data-sources',
  'preferences',
  'service-intervals',
  'maintenance',
  'privacy',
  'danger',
];

const DEFAULT_SECTION: SettingsSectionId = 'account';

function isKnown(value: string | null): value is SettingsSectionId {
  return !!value && (KNOWN_SECTIONS as readonly string[]).includes(value);
}

export function useSettingsSection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('section');
  const section: SettingsSectionId = isKnown(raw) ? raw : DEFAULT_SECTION;

  const setSection = useCallback(
    (next: SettingsSectionId) => {
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          n.set('section', next);
          return n;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  return useMemo(() => ({ section, setSection }), [section, setSection]);
}
