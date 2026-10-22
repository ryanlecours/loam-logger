import { useState } from 'react';
import { TriangleAlert, X } from 'lucide-react';
import { useOutageNotice } from '@/hooks/useOutageNotice';

/** Session-scoped so a dismissed notice stays gone for this tab only. */
const DISMISSED_KEY = 'loam.outageBanner.dismissed';

function readDismissed(): string | null {
  try {
    return window.sessionStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

function writeDismissed(message: string): void {
  try {
    window.sessionStorage.setItem(DISMISSED_KEY, message);
  } catch {
    // Storage blocked: the dismissal lasts until the next page load instead.
  }
}

/**
 * Flag-driven service notice, pinned to the bottom edge on every route so it
 * never fights the fixed top navbars. Dismissal is keyed to the message, so
 * an updated message (a new ETA, say) comes back after a dismissal.
 */
export default function OutageBanner() {
  const notice = useOutageNotice();
  const [dismissed, setDismissed] = useState<string | null>(readDismissed);

  if (!notice || dismissed === notice.message) return null;

  const dismiss = () => {
    writeDismissed(notice.message);
    setDismissed(notice.message);
  };

  return (
    <div className="outage-banner" role="status" aria-live="polite" data-testid="outage-banner">
      <TriangleAlert className="outage-banner-icon" aria-hidden="true" />
      <p className="outage-banner-text">{notice.message}</p>
      <button
        type="button"
        className="outage-banner-dismiss"
        onClick={dismiss}
        aria-label="Dismiss outage notice"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
