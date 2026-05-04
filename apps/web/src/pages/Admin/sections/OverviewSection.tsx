import { useEffect, useState } from 'react';
import { Input } from '../../../components/ui/Input';
import { Button } from '../../../components/ui/Button';
import type { AdminStats, LookupResult } from '../types';

/**
 * Overview section: at-a-glance platform stats plus a developer-tools
 * user-lookup form (used to grab a user's UUID for log filtering in
 * Railway). Keeping these together — rather than splitting "stats" and
 * "lookup" into separate sidebar entries — because both are quick read-only
 * surfaces and an admin landing on /admin usually wants one or the other.
 */
export function OverviewSection() {
  const [stats, setStats] = useState<AdminStats | null>(null);

  const [lookupEmail, setLookupEmail] = useState('');
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL}/api/admin/stats`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error('Failed to fetch stats');
        const data = await res.json();
        if (cancelled) return;
        setStats({
          userCount: data.users,
          waitlistCount: data.waitlist,
          foundingRidersCount: data.foundingRiders || 0,
        });
      } catch (err) {
        console.error('Failed to fetch stats:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLookupUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lookupEmail.trim()) {
      setLookupError('Email is required');
      return;
    }

    try {
      setLookingUp(true);
      setLookupError(null);
      setLookupResult(null);

      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/admin/lookup-user?email=${encodeURIComponent(lookupEmail.trim())}`,
        { credentials: 'include' },
      );

      if (res.status === 404) {
        setLookupError('User not found');
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Lookup failed');
      }

      const user = await res.json();
      setLookupResult(user);
    } catch (err) {
      console.error('Lookup failed:', err);
      setLookupError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setLookingUp(false);
    }
  };

  return (
    <>
      <div>
        <p className="label-section">Admin</p>
        <h1 className="text-3xl font-semibold text-white">Overview</h1>
        <p className="text-body-muted max-w-2xl">
          Platform stats at a glance, plus a quick user lookup for finding the userId you need to filter Railway logs.
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid gap-6 md:grid-cols-3">
        {[
          { label: 'Total Users', value: stats?.userCount },
          { label: 'Founding Riders', value: stats?.foundingRidersCount },
          { label: 'Waitlist Signups', value: stats?.waitlistCount },
        ].map((stat) => (
          <div key={stat.label} className="panel">
            <p className="label-section">{stat.label}</p>
            <p className="stat-value">
              {stat.value === undefined ? (
                <span
                  aria-hidden
                  className="inline-block h-8 w-16 rounded bg-surface-2/60 animate-pulse"
                />
              ) : (
                stat.value
              )}
            </p>
          </div>
        ))}
      </div>

      {/* User lookup */}
      <section className="panel-spaced">
        <div>
          <p className="label-section">Developer Tools</p>
          <h2 className="title-section">User Lookup</h2>
          <p className="text-body-muted mt-1">
            Look up a user by email to get their userId (for log filtering in Railway).
          </p>
        </div>

        <form onSubmit={handleLookupUser} className="flex gap-3 items-end">
          <div className="flex-1 max-w-md">
            <Input
              label="Email Address"
              type="email"
              value={lookupEmail}
              onChange={(e) => setLookupEmail(e.target.value)}
              placeholder="user@example.com"
              autoComplete="off"
            />
          </div>
          <Button type="submit" disabled={lookingUp || !lookupEmail.trim()}>
            {lookingUp ? 'Looking up…' : 'Lookup'}
          </Button>
        </form>

        {lookupError && (
          <div className="alert alert-danger-dark rounded-2xl">
            <p>{lookupError}</p>
          </div>
        )}

        {lookupResult && (
          <div className="p-4 rounded-xl bg-surface-2 border border-app space-y-3">
            <Row label="User ID">
              <code className="text-sm bg-surface-1 px-2 py-1 rounded font-mono select-all">
                {lookupResult.id}
              </code>
            </Row>
            <Row label="Email">{lookupResult.email}</Row>
            <Row label="Name">{lookupResult.name || '—'}</Row>
            <Row label="Role">{lookupResult.role}</Row>
            <Row label="Founding Rider">{lookupResult.isFoundingRider ? 'Yes' : 'No'}</Row>
            <Row label="Created">{new Date(lookupResult.createdAt).toLocaleDateString()}</Row>
            {lookupResult.activatedAt && (
              <Row label="Activated">
                {new Date(lookupResult.activatedAt).toLocaleDateString()}
              </Row>
            )}
          </div>
        )}
      </section>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}
