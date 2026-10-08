import { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { Check, Copy, Link2, Trash2 } from 'lucide-react';

import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import {
  COMPONENT_SHARES,
  CREATE_COMPONENT_SHARE,
  REVOKE_COMPONENT_SHARE,
} from '@/graphql/componentShare';
import { isoToDateInput, todayDateInput } from '@/lib/format';
import {
  fmtDay,
  localDayAfterIso,
  localDayStartIso,
  shareScopeLabel,
  type ComponentShareScope,
} from '@/lib/componentShare';

type Share = {
  id: string;
  scope: ComponentShareScope;
  rangeStart: string | null;
  rangeEnd: string | null;
  url: string;
  createdAt: string;
};

const SCOPES: Array<{ scope: ComponentShareScope; label: string }> = [
  { scope: 'LIFETIME', label: 'Lifetime' },
  { scope: 'SINCE_SERVICE', label: 'Since last service' },
  { scope: 'RANGE', label: 'Date range' },
];

/**
 * Share links for one window of a component's history. Each link is locked to
 * the window it was made for, so sharing "since last service" does not also
 * hand over the part's lifetime.
 */
export function ComponentSharePanel({
  componentId,
  installedAt,
}: {
  componentId: string;
  /** The component's first install, the earliest a date range may start. */
  installedAt: string;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<ComponentShareScope>('LIFETIME');
  const minDate = isoToDateInput(installedAt);
  const today = todayDateInput();
  const [from, setFrom] = useState(minDate);
  const [to, setTo] = useState(today);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetch = [{ query: COMPONENT_SHARES, variables: { componentId } }];
  const { data } = useQuery<{ component: { id: string; shares: Share[] } | null }>(COMPONENT_SHARES, {
    variables: { componentId },
    skip: !open,
  });
  const [createShare, { loading: creating }] = useMutation(CREATE_COMPONENT_SHARE, { refetchQueries: refetch });
  const [revokeShare] = useMutation(REVOKE_COMPONENT_SHARE, { refetchQueries: refetch });
  const shares = data?.component?.shares ?? [];

  const rangeInvalid = scope === 'RANGE' && (!from || !to || from > to || from < minDate || to > today);

  const copy = async (share: Pick<Share, 'id' | 'url'>) => {
    try {
      await navigator.clipboard.writeText(share.url);
      setCopiedId(share.id);
      setTimeout(() => setCopiedId((id) => (id === share.id ? null : id)), 2000);
    } catch {
      // The link is listed below either way, so it can be copied by hand.
    }
  };

  const handleCreate = async () => {
    setError(null);
    try {
      const { data: created } = await createShare({
        variables: {
          input: {
            componentId,
            scope,
            ...(scope === 'RANGE'
              ? { rangeStart: localDayStartIso(from), rangeEnd: localDayAfterIso(to) }
              : {}),
          },
        },
      });
      const share = created?.createComponentShare as Share | undefined;
      if (share) await copy(share);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the link.');
    }
  };

  const handleRevoke = async (id: string) => {
    setError(null);
    try {
      await revokeShare({ variables: { id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke the link.');
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Link2 size={14} className="icon-left" />
        Share
      </Button>

      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Share this component's history"
        subtitle="Anyone with a link sees that window: totals, the wear chart, the bikes it was on and its service dates. Notes, your name and weather are never shared."
        size="md"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="What to share">
            {SCOPES.map((s) => (
              <button
                key={s.scope}
                type="button"
                role="radio"
                aria-checked={scope === s.scope}
                onClick={() => setScope(s.scope)}
                className={`px-3 py-1 rounded-full text-xs border ${
                  scope === s.scope ? 'bg-mint/10 border-mint text-mint' : 'border-border text-muted'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {scope === 'SINCE_SERVICE' && (
            <p className="text-xs text-muted">
              This link keeps up: when you log a new service, it starts counting from that one.
            </p>
          )}

          {scope === 'RANGE' && (
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-muted">
                From
                <input
                  type="date"
                  value={from}
                  min={minDate}
                  max={to || today}
                  onChange={(e) => setFrom(e.target.value)}
                  className="log-service-date-input w-full mt-1"
                />
              </label>
              <label className="text-xs text-muted">
                To
                <input
                  type="date"
                  value={to}
                  min={from || minDate}
                  max={today}
                  onChange={(e) => setTo(e.target.value)}
                  className="log-service-date-input w-full mt-1"
                />
              </label>
            </div>
          )}

          <Button variant="primary" size="sm" onClick={handleCreate} disabled={creating || rangeInvalid}>
            {creating ? 'Creating link…' : 'Create and copy link'}
          </Button>

          {error && <div className="alert-inline alert-inline-error">{error}</div>}

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Your links</h3>
            {shares.length === 0 ? (
              <p className="text-sm text-muted">No links yet.</p>
            ) : (
              <ul className="space-y-2">
                {shares.map((share) => (
                  <li key={share.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm">{shareScopeLabel(share)}</div>
                      <div className="text-xs text-muted truncate">
                        Created {fmtDay(share.createdAt)} · {share.url}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copy(share)}
                      aria-label={`Copy the ${shareScopeLabel(share)} link`}
                    >
                      {copiedId === share.id ? <Check size={14} /> : <Copy size={14} />}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRevoke(share.id)}
                      aria-label={`Revoke the ${shareScopeLabel(share)} link`}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
