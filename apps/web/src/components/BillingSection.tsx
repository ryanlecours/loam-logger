import { gql, useMutation } from '@apollo/client';
import { CreditCard, ExternalLink } from 'lucide-react';
import { useUserTier } from '../hooks/useUserTier';

const CREATE_BILLING_PORTAL = gql`
  mutation CreateBillingPortalSession {
    createBillingPortalSession {
      url
    }
  }
`;

export default function BillingSection() {
  const { tier, isPro, isFoundingRider } = useUserTier();
  const [createPortal, { loading }] = useMutation(CREATE_BILLING_PORTAL);

  const handleManageBilling = async () => {
    try {
      const { data } = await createPortal();
      if (data?.createBillingPortalSession?.url) {
        window.open(data.createBillingPortalSession.url, '_blank');
      }
    } catch {
      // Error handled by Apollo
    }
  };

  const tierLabel = isFoundingRider
    ? 'Founding Rider (Lifetime Pro)'
    : tier === 'PRO'
      ? 'Pro'
      : 'Free';

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-white">Subscription</h3>
      <div className="rounded-2xl border border-app/60 bg-surface-2 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CreditCard className="h-5 w-5 text-muted" />
            <div>
              <p className="text-sm font-medium text-white">{tierLabel}</p>
              <p className="text-xs text-muted">
                {isFoundingRider
                  ? 'Lifetime access — thank you for your early support!'
                  : isPro
                    ? 'Unlimited bikes and all components'
                    : 'Upgrade for unlimited bikes and components'}
              </p>
            </div>
          </div>
          {isPro && !isFoundingRider && (
            <button
              onClick={handleManageBilling}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/10 disabled:opacity-50"
            >
              Manage
              <ExternalLink className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
