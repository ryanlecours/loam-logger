import { useSearchParams } from 'react-router-dom';
import { useCallback } from 'react';

export type AdminSectionId = 'overview' | 'users' | 'waitlist' | 'email';

const KNOWN_SECTIONS: readonly AdminSectionId[] = ['overview', 'users', 'waitlist', 'email'];

const DEFAULT_SECTION: AdminSectionId = 'overview';

function isKnown(value: string | null): value is AdminSectionId {
  return !!value && (KNOWN_SECTIONS as readonly string[]).includes(value);
}

export function useAdminSection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('section');
  const section: AdminSectionId = isKnown(raw) ? raw : DEFAULT_SECTION;

  const setSection = useCallback(
    (next: AdminSectionId) => {
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

  return { section, setSection };
}
