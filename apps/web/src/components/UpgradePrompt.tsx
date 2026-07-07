import { useState } from 'react';
import { Lock, X } from 'lucide-react';
import { useNavigate } from 'react-router';
import { UPSELL_COPY, type UpsellFeature } from '../constants/upsellCopy';

interface UpgradePromptProps {
  message: string;
  subtitle?: string;
}

const btn = 'rounded-lg px-4 py-2 text-sm font-medium transition';

export default function UpgradePrompt({ message, subtitle }: UpgradePromptProps) {
  const navigate = useNavigate();

  return (
    <div className="inline-flex flex-col items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-center">
      <Lock className="h-5 w-5 text-amber-400" />
      <p className="text-sm text-amber-200">{message}</p>
      {subtitle && <p className="whitespace-pre-line text-xs text-amber-200/60">{subtitle}</p>}
      <button
        onClick={() => navigate('/pricing')}
        className={`${btn} border border-white/20 text-white/80 hover:bg-white/10`}
      >
        Upgrade to Pro
      </button>
    </div>
  );
}

/**
 * Quiet inline "Pro" chip for spots where a gated value would render.
 * No copy of its own — clicking goes to /pricing. Use at most one full
 * UpsellCard per screen; every other gated spot gets this chip.
 */
export function ProChip({ className = '' }: { className?: string }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigate('/pricing');
      }}
      className={`inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400 transition hover:bg-amber-500/20 ${className}`.trim()}
      aria-label="Pro feature — see plans"
    >
      <Lock className="h-2.5 w-2.5" />
      Pro
    </button>
  );
}

/**
 * Dismissible feature upsell card driven by the shared copy map.
 * Dismissal is persisted per feature in localStorage and respected forever.
 */
export function UpsellCard({ feature, className = '' }: { feature: UpsellFeature; className?: string }) {
  const navigate = useNavigate();
  const copy = UPSELL_COPY[feature];
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(copy.dismissKey) === '1';
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(copy.dismissKey, '1');
    } catch {
      // Storage unavailable — dismiss for this session only.
    }
  };

  return (
    <div className={`relative rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 ${className}`.trim()}>
      <button
        type="button"
        onClick={dismiss}
        className="absolute right-2 top-2 rounded p-1 text-amber-200/50 transition hover:text-amber-200"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <p className="pr-6 text-sm font-semibold text-amber-200">{copy.title}</p>
      <p className="mt-1 pr-6 text-xs leading-relaxed text-amber-200/70">{copy.body}</p>
      <button
        onClick={() => navigate('/pricing')}
        className={`${btn} mt-3 border border-white/20 text-white/80 hover:bg-white/10`}
      >
        See Pro
      </button>
    </div>
  );
}
