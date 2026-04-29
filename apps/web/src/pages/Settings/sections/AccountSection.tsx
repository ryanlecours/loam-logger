import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, gql } from '@apollo/client';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import SetPasswordModal from '../../../components/SetPasswordModal';
import BillingSection from '../../../components/BillingSection';
import ReferralCard from '../../../components/ReferralCard';
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
        description="Your identity, plan, and referrals — everything tied to who you are on Loam Logger."
      />

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

      <div className="panel-spaced">
        <div>
          <p className="label-section">Rewards</p>
          <h2 className="title-section">Referrals</h2>
        </div>
        <ReferralCard />
      </div>

      <SetPasswordModal
        open={setPasswordModalOpen}
        onClose={() => setSetPasswordModalOpen(false)}
        onSuccess={refetchUser}
      />
    </div>
  );
}
