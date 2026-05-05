import { createContext, useContext } from 'react';
import type { AdminStats } from './types';

/**
 * Context + hook half of the admin-stats store. The matching provider
 * lives in AdminStatsProvider.tsx — the two were originally a single
 * file but ESLint's `react-refresh/only-export-components` rule requires
 * components and non-component exports to live separately so that Vite's
 * Fast Refresh can preserve component state on hot-reload.
 *
 * See AdminStatsProvider.tsx for usage rationale.
 */

export type AdminStatsContextValue = {
  stats: AdminStats | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

// Exported so the provider in AdminStatsProvider.tsx can mount the same
// context object the hook subscribes to. Not part of the public surface
// of this module — admin code should consume via `useAdminStats()`.
export const AdminStatsContext = createContext<AdminStatsContextValue | null>(null);

export function useAdminStats(): AdminStatsContextValue {
  const ctx = useContext(AdminStatsContext);
  if (!ctx) {
    throw new Error('useAdminStats must be used within <AdminStatsProvider>');
  }
  return ctx;
}
