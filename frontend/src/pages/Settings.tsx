import { useState, useEffect } from "react";
import { useQuery, gql } from "@apollo/client";
import { useSearchParams } from "react-router-dom";
import { FaMountain, FaGoogle } from "react-icons/fa";
import { formatDistanceToNow } from "date-fns";
import ThemeToggle from "../components/ThemeToggleButton";
import DeleteAccountModal from "../components/DeleteAccountModal";
import ConnectGarminLink from "../components/ConnectGarminLink";
import GarminImportModal from "../components/GarminImportModal";
import { useCurrentUser } from "../hooks/useCurrentUser";

const CONNECTED_ACCOUNTS_QUERY = gql`
  query ConnectedAccounts {
    me {
      id
      accounts {
        provider
        connectedAt
      }
    }
  }
`;

export default function Settings() {
  const { user } = useCurrentUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: accountsData, refetch: refetchAccounts } = useQuery(CONNECTED_ACCOUNTS_QUERY);
  const [hoursDisplay, setHoursDisplay] = useState<"total" | "remaining">("total");
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Check for Garmin connection success from OAuth redirect
  useEffect(() => {
    if (searchParams.get('garmin') === 'connected') {
      refetchAccounts();
      setSuccessMessage('Garmin connected successfully!');
      setTimeout(() => setSuccessMessage(null), 5000);
      // Clean up URL
      setSearchParams({});
    }
  }, [searchParams, setSearchParams, refetchAccounts]);

  const accounts = accountsData?.me?.accounts || [];
  const garminAccount = accounts.find((acc: { provider: string; connectedAt: string }) => acc.provider === "garmin");
  const isGarminConnected = !!garminAccount;

  const handleDisconnectGarmin = async () => {
    if (!confirm('Disconnect Garmin? Your synced rides will remain, but new activities will not sync.')) {
      return;
    }

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/garmin/disconnect`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!res.ok) throw new Error('Failed to disconnect');

      await refetchAccounts();
      setSuccessMessage('Garmin disconnected successfully');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Failed to disconnect Garmin:', err);
      alert('Failed to disconnect Garmin. Please try again.');
    }
  };

  const handleDeleteAccount = async () => {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/delete-account`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to delete account");
      }

      setDeleteModalOpen(false);
      setSuccessMessage("Account deleted successfully. Redirecting to login...");

      // Clear session and redirect after a short delay
      setTimeout(() => {
        window.location.href = "/login";
      }, 1500);
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div className="space-y-8">
      <section className="panel-soft shadow-soft border border-app rounded-3xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted">Settings</p>
            <h1 className="text-3xl font-semibold text-white">Tune Loam Logger to your workflow</h1>
            <p className="text-sm text-muted max-w-2xl">
              Manage account links, display preferences, and appearance so ride data flows exactly the way you want.
            </p>
          </div>
          <ThemeToggle />
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="panel-soft shadow-soft border border-app rounded-3xl p-6 space-y-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted">Account Linking</p>
            <h2 className="text-xl font-semibold text-white">Connected Services</h2>
          </div>
          <div className="space-y-3">
            {/* Google - always connected via login */}
            <div className="w-full rounded-2xl border border-app/70 bg-surface-2 px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <FaGoogle className="text-lg text-blue-400" />
                  <div>
                    <p className="font-semibold">Google</p>
                    <p className="text-sm text-muted">Used for login</p>
                  </div>
                </div>
                <span className="text-xs text-green-400">Connected</span>
              </div>
            </div>

            {/* Garmin */}
            {isGarminConnected ? (
              <div className="w-full rounded-2xl border border-app/70 bg-surface-2 px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <FaMountain className="text-lg" style={{ color: '#11A9ED' }} />
                    <div>
                      <p className="font-semibold">Garmin Connect</p>
                      <p className="text-xs text-muted">
                        Connected {formatDistanceToNow(new Date(garminAccount.connectedAt))} ago
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setImportModalOpen(true)}
                      className="rounded-xl px-3 py-1.5 text-xs font-medium text-blue-400/80 bg-surface-2/50 border border-blue-400/30 hover:bg-surface-2 hover:text-blue-400 hover:border-blue-400/50 hover:cursor-pointer transition"
                    >
                      Import Rides
                    </button>
                    <button
                      onClick={handleDisconnectGarmin}
                      className="rounded-xl px-3 py-1.5 text-xs font-medium text-red-400/80 bg-surface-2/50 border border-red-400/30 hover:bg-surface-2 hover:text-red-400 hover:border-red-400/50 hover:cursor-pointer transition"
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <ConnectGarminLink />
            )}

            {/* Suunto - Coming Soon */}
            <div className="w-full rounded-2xl border border-app/70 bg-surface-2/50 px-4 py-3 opacity-50">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-semibold">Suunto</p>
                  <p className="text-sm text-muted">Coming soon</p>
                </div>
                <span className="text-xs text-muted">Not available</span>
              </div>
            </div>
          </div>
        </div>

        <div className="panel-soft shadow-soft border border-app rounded-3xl p-6 space-y-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted">Profile</p>
            <h2 className="text-xl font-semibold text-white">Your info</h2>
          </div>
          <dl className="grid gap-4 text-sm">
            <div>
              <dt className="text-muted uppercase tracking-[0.3em] text-xs">Name</dt>
              <dd className="text-lg text-white">{user?.name ?? "Unknown rider"}</dd>
            </div>
            <div>
              <dt className="text-muted uppercase tracking-[0.3em] text-xs">Email</dt>
              <dd className="text-lg text-white">{user?.email ?? "—"}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="panel-soft shadow-soft border border-app rounded-3xl p-6 space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-muted">Preferences</p>
          <h2 className="text-xl font-semibold text-white">Component hours display</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label
            className={`cursor-pointer rounded-2xl border px-4 py-3 transition ${
              hoursDisplay === "total"
                ? "border-primary/60 bg-surface-accent/60"
                : "border-app/60 bg-surface-2"
            }`}
          >
            <input
              type="radio"
              name="hours-mode"
              value="total"
              className="mr-2"
              checked={hoursDisplay === "total"}
              onChange={() => setHoursDisplay("total")}
            />
            Show cumulative hours (e.g. 780h / 800h)
          </label>
          <label
            className={`cursor-pointer rounded-2xl border px-4 py-3 transition ${
              hoursDisplay === "remaining"
                ? "border-primary/60 bg-surface-accent/60"
                : "border-app/60 bg-surface-2"
            }`}
          >
            <input
              type="radio"
              name="hours-mode"
              value="remaining"
              className="mr-2"
              checked={hoursDisplay === "remaining"}
              onChange={() => setHoursDisplay("remaining")}
            />
            Show time until next service (e.g. 0h / 50h)
          </label>
        </div>
        <p className="text-xs text-muted">
          Total hours are always stored. This preference only affects how we display service intervals.
        </p>
      </section>

      {successMessage && (
        <section className="panel-soft shadow-soft border border-green-600/50 rounded-3xl p-6 bg-green-950/30 space-y-4">
          <div className="flex items-start gap-3">
            <div className="text-green-400">✓</div>
            <div>
              <h3 className="font-semibold text-green-100">{successMessage}</h3>
            </div>
          </div>
        </section>
      )}

      <section className="panel-soft shadow-soft border border-red-600/50 rounded-3xl p-6 bg-red-950/30 space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-red-400">Danger Zone</p>
          <h2 className="text-xl font-semibold text-white">Delete Account</h2>
        </div>
        <p className="text-sm text-red-200">
          Permanently delete your account and all associated data. This action cannot be undone.
        </p>
        <button
          onClick={() => setDeleteModalOpen(true)}
          className="rounded-2xl px-4 py-2 text-sm font-medium text-white transition
            bg-red-600 hover:bg-red-700 active:bg-red-800
            focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500
            dark:bg-red-700 dark:hover:bg-red-800"
        >
          Delete Account
        </button>
      </section>

      <DeleteAccountModal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleDeleteAccount}
      />

      <GarminImportModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onSuccess={() => {
          setSuccessMessage('Backfill triggered! Your rides will sync automatically via Garmin webhooks.');
          setTimeout(() => setSuccessMessage(null), 8000);
        }}
      />
    </div>
  );
}
