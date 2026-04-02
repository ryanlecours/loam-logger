import { Lock, Share2 } from 'lucide-react';
import { useNavigate } from 'react-router';

interface UpgradePromptProps {
  message: string;
  showReferral?: boolean;
}

export default function UpgradePrompt({ message, showReferral = true }: UpgradePromptProps) {
  const navigate = useNavigate();

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
      <div className="flex items-start gap-3">
        <Lock className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
        <div className="space-y-3">
          <p className="text-sm text-amber-200">{message}</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => navigate('/pricing')}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary/80"
            >
              Upgrade to Pro
            </button>
            {showReferral && (
              <button
                onClick={() => navigate('/settings#referral')}
                className="flex items-center gap-1.5 rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10"
              >
                <Share2 className="h-4 w-4" />
                Refer a friend
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
