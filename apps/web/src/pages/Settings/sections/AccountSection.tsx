import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery, useMutation, gql } from '@apollo/client';
import { toast } from 'sonner';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { useUserTier } from '../../../hooks/useUserTier';
import { UPDATE_USER_PREFERENCES_MUTATION } from '../../../graphql/userPreferences';
import SetPasswordModal from '../../../components/SetPasswordModal';
import BillingSection from '../../../components/BillingSection';
import SettingsSectionHeader from '../SettingsSectionHeader';

const CONNECTED_ACCOUNTS_FOR_PASSWORD = gql`
  query AccountsForPasswordSection {
    me {
      id
      accounts {
        provider
      }
    }
  }
`;

export default function AccountSection() {
  const navigate = useNavigate();
  const { user, refetch: refetchUser } = useCurrentUser();
  const { data: accountsData } = useQuery(CONNECTED_ACCOUNTS_FOR_PASSWORD, {
    fetchPolicy: 'cache-first',
  });
  const [setPasswordModalOpen, setSetPasswordModalOpen] = useState(false);

  const accounts: { provider: string }[] = accountsData?.me?.accounts ?? [];

  // Stripe checkout returns to /settings?billing=success (set server-side in
  // stripe.service.ts). AI is opt-in and off by default at every tier, so
  // the upgrade moment is where the option gets offered once; afterwards it
  // lives under Preferences. "Keep it off" only closes the card and stores
  // nothing. The checkout return is latched into state BEFORE the effect
  // strips it from the URL - state (not the param) keeps the card up for
  // this visit, and the strip is what makes the offer genuinely one-time:
  // without it, a reload or back/forward while ?billing=success is still in
  // the URL would remount with fresh state and resurrect a declined card.
  const [searchParams, setSearchParams] = useSearchParams();
  const [arrivedFromCheckout] = useState(
    () => searchParams.get('billing') === 'success',
  );

  useEffect(() => {
    if (searchParams.get('billing') === 'success') {
      const next = new URLSearchParams(searchParams);
      next.delete('billing');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const { isPro } = useUserTier();

  // The Stripe webhook that flips subscriptionTier races the redirect back
  // here, with no ordering guarantee, and the success URL carries no session
  // id so the client cannot reconcile synchronously. On a checkout return
  // that still reads as free, poll me every 2s for up to 30s. The latch
  // above keeps the offer armed for the visit and showAiOffer is reactive
  // to isPro (useUserTier reads the same ME_QUERY document), so the offer
  // card and the plan panel below both appear the moment the webhook lands
  // instead of the one-time offer being silently lost to a slow webhook.
  useEffect(() => {
    if (!arrivedFromCheckout || isPro) return;
    let attempts = 0;
    const intervalId = setInterval(() => {
      attempts += 1;
      if (attempts > 15) {
        clearInterval(intervalId);
        return;
      }
      refetchUser().catch(() => {
        // Transient fetch failure: keep polling until the attempt cap.
      });
    }, 2000);
    return () => clearInterval(intervalId);
  }, [arrivedFromCheckout, isPro, refetchUser]);
  const [updateUserPreferences, { loading: aiOfferSaving }] = useMutation(
    UPDATE_USER_PREFERENCES_MUTATION,
  );
  const [aiOfferClosed, setAiOfferClosed] = useState(false);

  const showAiOffer =
    arrivedFromCheckout &&
    isPro &&
    !!user &&
    !user.aiFeaturesEnabled &&
    !aiOfferClosed;

  const handleEnableAi = async () => {
    try {
      await updateUserPreferences({ variables: { input: { aiFeaturesEnabled: true } } });
      toast.success('AI maintenance summary is on', {
        description: 'You can turn it off any time under Preferences.',
      });
      setAiOfferClosed(true);
    } catch {
      toast.error('Could not save that. The toggle also lives under Preferences.');
    }
  };

  const handleSetPassword = () => {
    if (user?.needsReauthForSensitiveActions) {
      navigate('/login?returnTo=/settings&reason=reauth');
    } else {
      setSetPasswordModalOpen(true);
    }
  };

  const handleChangePassword = () => {
    if (user?.needsReauthForSensitiveActions) {
      navigate('/login?returnTo=/settings&reason=reauth');
    } else {
      navigate('/change-password?mode=change');
    }
  };

  return (
    <div className="space-y-6">
      <SettingsSectionHeader
        eyebrow="Account"
        title="Your profile"
        description="Your identity and plan — everything tied to who you are on Loam Logger."
      />

      {showAiOffer && (
        <div className="panel-spaced">
          <div>
            <p className="label-section">Welcome to Pro</p>
            <h2 className="title-section">Want the AI maintenance summary?</h2>
          </div>
          <p className="text-sm text-muted">
            Pro can add a short machine-generated read of each bike's wear
            picture to your dashboard. It is off by default and entirely
            optional; every other Pro feature works the same either way.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleEnableAi}
              disabled={aiOfferSaving}
              className="btn-primary disabled:opacity-50"
            >
              Turn it on
            </button>
            <button
              type="button"
              onClick={() => setAiOfferClosed(true)}
              className="text-sm text-muted hover:text-primary transition"
            >
              Keep it off
            </button>
          </div>
        </div>
      )}

      <div className="panel-spaced">
        <div>
          <p className="label-section">Profile</p>
          <h2 className="title-section">Your info</h2>
        </div>
        <dl className="grid gap-4 text-sm">
          <div>
            <dt className="text-muted uppercase tracking-[0.3em] text-xs">Name</dt>
            <dd className="text-lg text-white">{user?.name ?? 'Unknown rider'}</dd>
          </div>
          <div>
            <dt className="text-muted uppercase tracking-[0.3em] text-xs">Email</dt>
            <dd className="text-lg text-white">{user?.email ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted uppercase tracking-[0.3em] text-xs">Password</dt>
            <dd className="text-lg text-white flex items-center gap-3">
              {user?.hasPassword ? (
                <>
                  <span>••••••••</span>
                  <button
                    type="button"
                    onClick={handleChangePassword}
                    className="text-sm text-primary hover:text-primary/80 transition"
                  >
                    Change
                  </button>
                </>
              ) : accounts.length > 0 ? (
                <>
                  <span className="text-muted">Not set</span>
                  <button
                    type="button"
                    onClick={handleSetPassword}
                    className="text-sm text-primary hover:text-primary/80 transition"
                  >
                    Set Password
                  </button>
                </>
              ) : (
                <span className="text-muted">—</span>
              )}
            </dd>
          </div>
        </dl>
      </div>

      <div className="panel-spaced">
        <div>
          <p className="label-section">Plan</p>
          <h2 className="title-section">Subscription & Billing</h2>
        </div>
        <BillingSection />
      </div>

      <SetPasswordModal
        open={setPasswordModalOpen}
        onClose={() => setSetPasswordModalOpen(false)}
        onSuccess={refetchUser}
      />
    </div>
  );
}
