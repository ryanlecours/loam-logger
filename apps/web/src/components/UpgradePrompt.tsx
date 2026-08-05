import { useState } from 'react';
import { X } from 'lucide-react';
import { useNavigate } from 'react-router';
import { UPSELL_COPY, type UpsellFeature } from '../constants/upsellCopy';

const btn = 'rounded-lg px-4 py-2 text-sm font-medium transition';

/**
 * Quiet inline "Pro" chip for spots where a gated value would render.
 * No copy of its own — clicking goes to /pricing. Use at most one full
 * UpsellCard per screen; every other gated spot gets this chip.
 *
 * No padlock, and mint rather than amber: gating is commercial messaging,
 * so it wears the same accent as the Upgrade button, never a warning color
 * and never the health ramp. Mirrors the mobile ProChip.
 */
export function ProChip({ className = '', source = 'pro-chip' }: { className?: string; source?: string }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigate(`/pricing?source=${encodeURIComponent(source)}`);
      }}
      className={`inline-flex items-center gap-1 rounded-full border border-mint/30 bg-mint/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-mint transition hover:bg-mint/25 ${className}`.trim()}
      aria-label="Included with Pro — see plans"
    >
      Pro
    </button>
  );
}

/**
 * Dismissible feature upsell card driven by the shared copy map.
 * Dismissal is persisted per feature in localStorage and respected until the
 * user's situation materially changes: pass `rearmKey` when a state change
 * (e.g. a part going past due) justifies showing a dismissed card one more
 * time. The dismissal stores the key it was dismissed under, so each distinct
 * key re-arms the card at most once.
 */
export function UpsellCard({
  feature,
  className = '',
  rearmKey,
  body,
  persist = true,
  onDismiss,
}: {
  feature: UpsellFeature;
  className?: string;
  rearmKey?: string;
  body?: string;
  /**
   * Pass false for cards revealed by an explicit user action (e.g. clicking a
   * gated button): the card should show every time the action is taken, so
   * dismissal is session-only and stored dismissals are ignored.
   */
  persist?: boolean;
  onDismiss?: () => void;
}) {
  const navigate = useNavigate();
  const copy = UPSELL_COPY[feature];
  const currentKey = rearmKey ?? '1';
  const [dismissed, setDismissed] = useState(() => {
    if (!persist) return false;
    try {
      const stored = localStorage.getItem(copy.dismissKey);
      // Legacy dismissals stored '1'; treat them as dismissed for the base
      // state but let a rearmKey supersede them.
      return stored !== null && (stored === currentKey || rearmKey === undefined);
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    onDismiss?.();
    if (!persist) return;
    try {
      localStorage.setItem(copy.dismissKey, currentKey);
    } catch {
      // Storage unavailable — dismiss for this session only.
    }
  };

  return (
    <div className={`relative rounded-2xl border border-mint/30 bg-mint/10 p-4 ${className}`.trim()}>
      <button
        type="button"
        onClick={dismiss}
        className="absolute right-2 top-2 rounded p-1 text-muted transition hover:text-white"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <p className="pr-6 text-sm font-semibold text-white">{copy.title}</p>
      <p className="mt-1 pr-6 text-xs leading-relaxed text-muted">{body ?? copy.body}</p>
      <button
        onClick={() => navigate(`/pricing?source=upsell-${feature}`)}
        className={`${btn} mt-3 border border-white/20 text-white/80 hover:bg-white/10`}
      >
        See Pro
      </button>
    </div>
  );
}
