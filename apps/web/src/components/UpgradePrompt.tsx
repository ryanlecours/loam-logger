import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useNavigate } from 'react-router';
import { UPSELL_COPY, type UpsellFeature } from '../constants/upsellCopy';

/**
 * A dismissal stores the set of re-arm tokens it covered (legacy dismissals
 * stored the literal '1', which participates as an ordinary token). The card
 * is dismissed only while every current token is covered, so each NEW token
 * (e.g. a different part crossing its service interval) re-arms the card
 * exactly once, while shrinking or repeating token sets stay dismissed.
 */
function isCovered(stored: string | null, tokens: string[]): boolean {
  if (stored === null) return false;
  const covered = new Set(stored.split(','));
  return tokens.every((t) => covered.has(t));
}

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
 * user's situation materially changes: pass `rearmKey` as a comma-separated
 * token set (e.g. the ids of parts past their service interval) and the card
 * re-arms once per token a previous dismissal has not covered.
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
  const currentTokens = useMemo(
    () => (rearmKey === undefined ? [] : rearmKey.split(',').filter(Boolean)),
    [rearmKey]
  );
  // Computed per render (not in a mount-time initializer) so a rearmKey that
  // arrives after data loads still re-arms the card.
  const storedDismissed = useMemo(() => {
    if (!persist) return false;
    try {
      return isCovered(localStorage.getItem(copy.dismissKey), currentTokens);
    } catch {
      return false;
    }
  }, [persist, copy.dismissKey, currentTokens]);
  const [sessionDismissed, setSessionDismissed] = useState(false);

  if (storedDismissed || sessionDismissed) return null;

  const dismiss = () => {
    setSessionDismissed(true);
    onDismiss?.();
    if (!persist) return;
    try {
      const covered = new Set(
        (localStorage.getItem(copy.dismissKey) ?? '').split(',').filter(Boolean)
      );
      covered.add('1');
      currentTokens.forEach((t) => covered.add(t));
      localStorage.setItem(copy.dismissKey, Array.from(covered).join(','));
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
