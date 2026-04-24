import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

type Args<T> = {
  /** Current UI value (from e.g. `usePreferences()`). */
  value: T;
  /** Setter from the same context. Used both to hydrate from DB and to revert on mutation failure. */
  setValue: (v: T) => void;
  /**
   * The authoritative value from the server (e.g. `user.distanceUnit` on the
   * `me` query). May be null/undefined before the query resolves. The hook
   * syncs it into local state exactly once — subsequent Apollo refetches
   * won't clobber a pending UI change.
   */
  dbValue: T | null | undefined;
  /** Fires the mutation. Return the promise so we can detect failure. */
  mutate: (v: T) => Promise<unknown>;
  /** Human label used in the toast description: "Distance unit". */
  label: string;
  debounceMs?: number;
};

export function useAutoSavePreference<T>({
  value,
  setValue,
  dbValue,
  mutate,
  label,
  debounceMs = 400,
}: Args<T>) {
  const syncedRef = useRef(false);
  const savedValueRef = useRef<T>(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingIdRef = useRef(0);

  // One-shot hydrate from the DB value once it arrives.
  useEffect(() => {
    if (syncedRef.current) return;
    if (dbValue == null) return;
    savedValueRef.current = dbValue;
    setValue(dbValue);
    syncedRef.current = true;
  }, [dbValue, setValue]);

  // Auto-save on change (only after hydration).
  useEffect(() => {
    if (!syncedRef.current) return;
    if (value === savedValueRef.current) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    const myId = ++pendingIdRef.current;
    const attemptValue = value;

    timerRef.current = setTimeout(async () => {
      try {
        await mutate(attemptValue);
        if (pendingIdRef.current !== myId) return;
        savedValueRef.current = attemptValue;
        toast.success('Saved', {
          id: `settings-preference-${label}`,
          description: label,
        });
      } catch (err) {
        if (pendingIdRef.current !== myId) return;
        setValue(savedValueRef.current);
        toast.error(`Couldn't save ${label}`, {
          id: `settings-preference-${label}`,
          description: err instanceof Error ? err.message : 'Please try again.',
        });
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, mutate, setValue, label, debounceMs]);
}
