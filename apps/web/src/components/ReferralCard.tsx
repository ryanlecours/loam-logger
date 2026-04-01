import { gql, useQuery } from '@apollo/client';
import { Copy, Check, Share2 } from 'lucide-react';
import { useState } from 'react';

const REFERRAL_STATS = gql`
  query ReferralStats {
    referralStats {
      referralCode
      referralLink
      pendingCount
      completedCount
    }
  }
`;

export default function ReferralCard() {
  const { data } = useQuery(REFERRAL_STATS);
  const [copied, setCopied] = useState(false);

  const stats = data?.referralStats;
  if (!stats?.referralCode) return null;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(stats.referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div id="referral" className="space-y-3">
      <h3 className="text-sm font-medium text-white">Referral Program</h3>
      <div className="rounded-2xl border border-app/60 bg-surface-2 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <Share2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <p className="text-sm text-white">Share with a friend to unlock all components</p>
            <p className="text-xs text-muted mt-1">
              When they complete onboarding, you unlock Full Bike Analysis — wear tracking on all 23+ component types on your bike. Upgrade to Pro for unlimited bikes.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            readOnly
            value={stats.referralLink}
            className="flex-1 rounded-lg border border-app/40 bg-surface-1 px-3 py-2 text-xs text-muted select-all"
          />
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-lg bg-primary/20 px-3 py-2 text-xs font-medium text-primary transition hover:bg-primary/30"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        {(stats.pendingCount > 0 || stats.completedCount > 0) && (
          <div className="flex gap-4 text-xs text-muted">
            <span>{stats.pendingCount} pending</span>
            <span>{stats.completedCount} completed</span>
          </div>
        )}
      </div>
    </div>
  );
}
