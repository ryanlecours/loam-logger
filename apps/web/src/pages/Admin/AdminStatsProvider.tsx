import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AdminStatsContext } from './useAdminStats';
import type { AdminStats } from './types';

/**
 * Cross-section admin-stats store.
 *
 * Background: in the original Admin.tsx every section lived on a single
 * scrollable page, and every mutation (activate, delete, demote, etc.)
 * called `fetchStats()` afterwards so the header stat cards stayed
 * accurate. After the refactor split each section into its own file, the
 * stats lived in OverviewSection — section isolation broke the implicit
 * "one page, one fetchStats" contract: a delete in UsersSection couldn't
 * reach into Overview to refresh counts, leaving stale counters visible
 * the next time the admin landed on Overview.
 *
 * Pattern: keep stats and a `refresh()` action in a thin context provided
 * once at the Admin entry point. Section-local mutations call `refresh()`
 * after a successful write; OverviewSection reads `stats` and renders.
 * No prop drilling, no per-section fetch logic, no side-channel events.
 */
export function AdminStatsProvider({ children }: { children: ReactNode }) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/stats`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch stats');
      const data = await res.json();
      setStats({
        userCount: data.users,
        foundingRidersCount: data.foundingRiders || 0,
      });
    } catch (err) {
      // Stats refresh is fire-and-forget from a UX perspective — failure
      // doesn't block the mutation that triggered it. Log and move on;
      // the next successful refresh will replace the stale data.
      console.error('Failed to fetch admin stats:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load. Uses an effect rather than calling `refresh` synchronously
  // during render so the network call is deferred until after first paint.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <AdminStatsContext.Provider value={{ stats, loading, refresh }}>
      {children}
    </AdminStatsContext.Provider>
  );
}
