import { useState } from 'react';
import { gql, useMutation } from '@apollo/client';
import { useNavigate } from 'react-router-dom';
import { CreditCard, ExternalLink } from 'lucide-react';
import { useUserTier } from '../hooks/useUserTier';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';

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
  const [showConfirm, setShowConfirm] = useState(false);
  const navigate = useNavigate();

  const handleConfirmNavigate = async () => {
    try {
      const { data } = await createPortal();
      if (data?.createBillingPortalSession?.url) {
        window.location.href = data.createBillingPortalSession.url;
      }
    } catch {
      setShowConfirm(false);
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
              onClick={() => setShowConfirm(true)}
              className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/10 disabled:opacity-50"
            >
              Manage
              <ExternalLink className="h-3 w-3" />
            </button>
          )}
          {!isPro && (
            <button
              onClick={() => navigate('/pricing')}
              className="flex items-center gap-1.5 rounded-lg bg-mint/15 border border-mint/30 px-3 py-1.5 text-xs font-medium text-mint transition hover:bg-mint/25"
            >
              Upgrade
            </button>
          )}
        </div>
      </div>

      <Modal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        title="Manage Subscription"
        size="sm"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setShowConfirm(false)} disabled={loading}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleConfirmNavigate} disabled={loading}>
              {loading ? 'Loading...' : 'Continue to Stripe'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          You'll be redirected to Stripe to manage your subscription. You'll be brought back to LoamLogger when you're done.
        </p>
      </Modal>
    </div>
  );
}
