import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

type Args<T> = {
  value: T;
  /** Value currently persisted on the server; typically synced from the `me` query. */
  savedValue: T;
  setSavedValue: (v: T) => void;
  /** Snap UI back to `savedValue` after a failed mutation. */
  onRevert: (v: T) => void;
  /** Fires the mutation. Return the promise so we can detect failure. */
  mutate: (v: T) => Promise<unknown>;
  /** Human label used in the toast description: "Distance unit". */
  label: string;
  debounceMs?: number;
  /**
   * True when `savedValue` reflects a real DB read, not the initial default.
   * Prevents the hook from firing a spurious save on first render.
   */
  isSynced: boolean;
};

export function useAutoSavePreference<T>({
  value,
  savedValue,
  setSavedValue,
  onRevert,
  mutate,
  label,
  debounceMs = 400,
  isSynced,
}: Args<T>) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingIdRef = useRef(0);

  useEffect(() => {
    if (!isSynced) return;
    if (value === savedValue) return;

    if (timerRef.current) clearTimeout(timerRef.current);

    const myId = ++pendingIdRef.current;
    const attemptValue = value;

    timerRef.current = setTimeout(async () => {
      try {
        await mutate(attemptValue);
        if (pendingIdRef.current !== myId) return;
        setSavedValue(attemptValue);
        toast.success('Saved', {
          id: `settings-preference-${label}`,
          description: label,
        });
      } catch (err) {
        if (pendingIdRef.current !== myId) return;
        onRevert(savedValue);
        toast.error(`Couldn't save ${label}`, {
          id: `settings-preference-${label}`,
          description: err instanceof Error ? err.message : 'Please try again.',
        });
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, savedValue, isSynced, mutate, setSavedValue, onRevert, label, debounceMs]);
}
