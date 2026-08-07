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

// Per-tab latch for the post-checkout AI offer. It cannot live in component
// state: the settings shell mounts only the active section, so switching to
// another settings tab unmounts this component, and by then the effect below
// has already stripped billing=success from the URL - a state latch would
// re-initialize to false on the way back and silently lose the one-time
// offer. sessionStorage survives remounts and reloads within the tab, and
// the key is removed the moment the rider answers either way, which also
// makes a decline durable across reloads (the param strip alone only made
// it durable within one mount).
const AI_OFFER_PENDING_KEY = 'loam-ai-offer-pending';

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
  // lives under Preferences. "Keep it off" closes the card and stores
  // nothing server-side. The checkout return is latched (state + the
  // sessionStorage key, see AI_OFFER_PENDING_KEY above) BEFORE the effect
  // strips it from the URL, so the offer survives section remounts and
  // reloads until answered, while the strip keeps a stale
  // ?billing=success in history from re-arming an answered one.
  const [searchParams, setSearchParams] = useSearchParams();
  const [arrivedFromCheckout, setArrivedFromCheckout] = useState(
    () =>
      searchParams.get('billing') === 'success' ||
      sessionStorage.getItem(AI_OFFER_PENDING_KEY) === '1',
  );

  useEffect(() => {
    if (searchParams.get('billing') === 'success') {
      sessionStorage.setItem(AI_OFFER_PENDING_KEY, '1');
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

  const showAiOffer =
    arrivedFromCheckout && isPro && !!user && !user.aiFeaturesEnabled;

  // Answering either way retires the offer for good: clear the per-tab
  // latch first so no later remount can resurrect the card.
  const closeAiOffer = () => {
    sessionStorage.removeItem(AI_OFFER_PENDING_KEY);
    setArrivedFromCheckout(false);
  };

  const handleEnableAi = async () => {
    try {
      await updateUserPreferences({ variables: { input: { aiFeaturesEnabled: true } } });
      toast.success('AI maintenance summary is on', {
        description: 'You can turn it off any time under Preferences.',
      });
      closeAiOffer();
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
              onClick={closeAiOffer}
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
