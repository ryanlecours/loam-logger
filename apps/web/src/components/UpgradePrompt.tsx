import { Lock, Share2 } from 'lucide-react';
import { useNavigate } from 'react-router';

interface UpgradePromptProps {
  message: string;
  subtitle?: string;
  showReferral?: boolean;
}

const btn = 'rounded-lg px-4 py-2 text-sm font-medium transition';

export default function UpgradePrompt({ message, subtitle, showReferral = true }: UpgradePromptProps) {
  const navigate = useNavigate();

  return (
    <div className="inline-flex flex-col items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-center">
      <Lock className="h-5 w-5 text-amber-400" />
      <p className="text-sm text-amber-200">{message}</p>
      {subtitle && <p className="whitespace-pre-line text-xs text-amber-200/60">{subtitle}</p>}
      <div className="flex flex-wrap justify-center gap-2">
        {showReferral && (
          <button
            onClick={() => navigate('/settings#referral')}
            className={`${btn} flex items-center gap-1.5 border border-amber-500 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20`}
          >
            <Share2 className="h-4 w-4" />
            Refer a friend
          </button>
        )}
        <button
          onClick={() => navigate('/pricing')}
          className={`${btn} border border-white/20 text-white/80 hover:bg-white/10`}
        >
          Upgrade to Pro
        </button>
      </div>
    </div>
  );
}
