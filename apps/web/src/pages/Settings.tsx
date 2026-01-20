import { useState, useEffect } from "react";
import { useQuery, useMutation, gql } from "@apollo/client";
import { useSearchParams } from "react-router-dom";
import { FaMountain, FaGoogle, FaStrava } from "react-icons/fa";
import { formatDistanceToNow } from "date-fns";
import ThemeToggle from "../components/ThemeToggleButton";
import DeleteAccountModal from "../components/DeleteAccountModal";
import ConnectGarminLink from "../components/ConnectGarminLink";
import ConnectStravaLink from "../components/ConnectStravaLink";
import GarminImportModal from "../components/GarminImportModal";
import StravaImportModal from "../components/StravaImportModal";
import StravaGearMappingModal from "../components/StravaGearMappingModal";
import DataSourceSelector from "../components/DataSourceSelector";
import DuplicateRidesModal from "../components/DuplicateRidesModal";
import { UNMAPPED_STRAVA_GEARS } from "../graphql/stravaGear";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { usePreferences } from "../hooks/usePreferences";
import { getAuthHeaders } from "@/lib/csrf";
import { UPDATE_USER_PREFERENCES_MUTATION } from "../graphql/userPreferences";

const CONNECTED_ACCOUNTS_QUERY = gql`
  query ConnectedAccounts {
    me {
      id
      activeDataSource
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
  const { data: accountsData, refetch: refetchAccounts } = useQuery(CONNECTED_ACCOUNTS_QUERY, {
    fetchPolicy: 'cache-and-network',
  });
  const { data: unmappedData, refetch: refetchUnmapped } = useQuery(UNMAPPED_STRAVA_GEARS, {
    fetchPolicy: 'cache-and-network',
  });
  const { hoursDisplay, setHoursDisplay } = usePreferences();
  const [savedHoursDisplay, setSavedHoursDisplay] = useState(hoursDisplay);
  const [preferenceSaving, setPreferenceSaving] = useState(false);
  const [updateUserPreferences] = useMutation(UPDATE_USER_PREFERENCES_MUTATION);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [stravaImportModalOpen, setStravaImportModalOpen] = useState(false);
  const [duplicatesModalOpen, setDuplicatesModalOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [activeDataSource, setActiveDataSource] = useState<'garmin' | 'strava' | null>(null);
  const [stravaDeleteLoading, setStravaDeleteLoading] = useState(false);
  const [garminDeleteLoading, setGarminDeleteLoading] = useState(false);
  const [stravaMappingModalOpen, setStravaMappingModalOpen] = useState(false);

  // Check for OAuth connection callbacks
  useEffect(() => {
    if (searchParams.get('garmin') === 'connected') {
      refetchAccounts();
      setSuccessMessage('Garmin connected successfully!');
      setTimeout(() => setSuccessMessage(null), 5000);
      setSearchParams({});
    }

    if (searchParams.get('strava') === 'connected') {
      refetchAccounts();
      if (searchParams.get('prompt') === 'choose-source') {
        setSuccessMessage('Strava connected! Choose your active data source below.');
      } else {
        setSuccessMessage('Strava connected successfully!');
      }
      setTimeout(() => setSuccessMessage(null), 8000);
      setSearchParams({});
    }
  }, [searchParams, setSearchParams, refetchAccounts]);

  // Sync activeDataSource from GraphQL data
  useEffect(() => {
    if (accountsData?.me?.activeDataSource) {
      setActiveDataSource(accountsData.me.activeDataSource);
    }
  }, [accountsData]);

  // Sync hoursDisplay preference from database when user data loads
  useEffect(() => {
    if (user?.hoursDisplayPreference) {
      const dbPref = user.hoursDisplayPreference as 'total' | 'remaining';
      setSavedHoursDisplay(dbPref);
      setHoursDisplay(dbPref);
    }
  }, [user?.hoursDisplayPreference, setHoursDisplay]);

  const accounts = accountsData?.me?.accounts || [];
  const garminAccount = accounts.find((acc: { provider: string; connectedAt: string }) => acc.provider === "garmin");
  const stravaAccount = accounts.find((acc: { provider: string; connectedAt: string }) => acc.provider === "strava");
  const isGarminConnected = !!garminAccount;
  const isStravaConnected = !!stravaAccount;

  const handleDisconnectGarmin = async () => {
    if (!confirm('Disconnect Garmin? Your synced rides will remain, but new activities will not sync.')) {
      return;
    }

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/garmin/disconnect`, {
        method: 'DELETE',
        credentials: 'include',
        headers: getAuthHeaders(),
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

  const handleDisconnectStrava = async () => {
    if (!confirm('Disconnect Strava? Your synced rides will remain, but new activities will not sync.')) {
      return;
    }

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/strava/disconnect`, {
        method: 'DELETE',
        credentials: 'include',
        headers: getAuthHeaders(),
      });

      if (!res.ok) throw new Error('Failed to disconnect');

      await refetchAccounts();
      setSuccessMessage('Strava disconnected successfully');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Failed to disconnect Strava:', err);
      alert('Failed to disconnect Strava. Please try again.');
    }
  };

  const handleDataSourceSelect = async (provider: 'garmin' | 'strava') => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/data-source/preference`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: JSON.stringify({ provider }),
      });

      if (!res.ok) throw new Error('Failed to set data source');

      const data = await res.json();
      setActiveDataSource(data.activeDataSource);
      await refetchAccounts();
      setSuccessMessage(`Active data source set to ${provider.charAt(0).toUpperCase() + provider.slice(1)}`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Failed to set data source:', err);
      alert('Failed to set data source. Please try again.');
    }
  };

  const handleDeleteStravaRides = async () => {
    if (!confirm('Delete ALL rides imported from Strava? This also removes the hours added to your bikes from those rides.')) {
      return;
    }

    setStravaDeleteLoading(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/strava/testing/delete-imported-rides`, {
        method: 'DELETE',
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to delete Strava rides');

      const data = await res.json();
      const deleted = Number(data.deletedRides || 0);
      const message =
        deleted > 0
          ? `Deleted ${deleted} Strava ride${deleted === 1 ? '' : 's'} and reset component hours.`
          : 'No Strava rides found to delete.';
      setSuccessMessage(message);
      setTimeout(() => setSuccessMessage(null), 6000);
    } catch (err) {
      console.error('Failed to delete Strava rides:', err);
      alert('Failed to delete Strava rides. Please try again.');
    } finally {
      setStravaDeleteLoading(false);
    }
  };

  const handleDeleteGarminRides = async () => {
    if (!confirm('Delete ALL rides imported from Garmin? This also removes the hours added to your bikes from those rides.')) {
      return;
    }

    setGarminDeleteLoading(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/garmin/testing/delete-imported-rides`, {
        method: 'DELETE',
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to delete Garmin rides');

      const data = await res.json();
      const deleted = Number(data.deletedRides || 0);
      const message =
        deleted > 0
          ? `Deleted ${deleted} Garmin ride${deleted === 1 ? '' : 's'} and reset component hours.`
          : 'No Garmin rides found to delete.';
      setSuccessMessage(message);
      setTimeout(() => setSuccessMessage(null), 6000);
    } catch (err) {
      console.error('Failed to delete Garmin rides:', err);
      alert('Failed to delete Garmin rides. Please try again.');
    } finally {
      setGarminDeleteLoading(false);
    }
  };

  const handleSavePreferences = async () => {
    setPreferenceSaving(true);
    try {
      await updateUserPreferences({
        variables: {
          input: { hoursDisplayPreference: hoursDisplay },
        },
      });
      setSavedHoursDisplay(hoursDisplay);
      setSuccessMessage('Preferences saved successfully');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Failed to save preferences:', err);
      alert('Failed to save preferences. Please try again.');
    } finally {
      setPreferenceSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/delete-account`, {
        method: "DELETE",
        credentials: "include",
        headers: getAuthHeaders(),
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
    <div className="page-container space-y-8">
      <section className="panel">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="label-section">Settings</p>
            <h1 className="text-3xl font-semibold text-white">Tune Loam Logger to your workflow</h1>
            <p className="text-body-muted max-w-md">
              Manage account links, display preferences, and appearance so ride data flows exactly the way you want.
            </p>
          </div>
          <ThemeToggle />
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="panel-spaced">
          <div>
            <p className="label-section">Account Linking</p>
            <h2 className="title-section">Connected Services</h2>
          </div>
          <div className="space-y-3">
            {/* Google - always connected via login */}
            <div className="w-full rounded-2xl border border-app/70 bg-surface-2 px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <FaGoogle className="text-lg text-blue-400" />
                  <div>
                    <p className="font-semibold">Google</p>
                    <p className="text-body-muted">Used for login</p>
                  </div>
                </div>
                <span className="text-xs text-success">Connected</span>
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
                      Import Previous Rides
                    </button>
                    <button
                      onClick={handleDeleteGarminRides}
                      disabled={garminDeleteLoading}
                      className="rounded-xl px-3 py-1.5 text-xs font-medium text-orange-200/90 bg-transparent border border-orange-200/40 hover:bg-orange-500/10 hover:border-orange-200/70 hover:text-orange-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {garminDeleteLoading ? 'Deleting…' : 'Clear Garmin Rides'}
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

            {/* Strava */}
            {isStravaConnected ? (
              <div className="w-full rounded-2xl border border-app/70 bg-surface-2 px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <FaStrava className="text-lg" style={{ color: '#FC4C02' }} />
                    <div>
                      <p className="font-semibold">Strava</p>
                      <p className="text-xs text-muted">
                        Connected {formatDistanceToNow(new Date(stravaAccount.connectedAt))} ago
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setStravaImportModalOpen(true)}
                      className="rounded-xl px-3 py-1.5 text-xs font-medium text-[#FC4C02]/80 bg-surface-2/50 border border-[#FC4C02]/30 hover:bg-surface-2 hover:text-[#FC4C02] hover:border-[#FC4C02]/50 hover:cursor-pointer transition"
                    >
                      Import Previous Rides
                    </button>
                    <button
                      onClick={handleDeleteStravaRides}
                      disabled={stravaDeleteLoading}
                      className="rounded-xl px-3 py-1.5 text-xs font-medium text-orange-200/90 bg-transparent border border-orange-200/40 hover:bg-orange-500/10 hover:border-orange-200/70 hover:text-orange-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {stravaDeleteLoading ? 'Deleting…' : 'Clear Strava Rides'}
                    </button>
                    <button
                      onClick={handleDisconnectStrava}
                      className="rounded-xl px-3 py-1.5 text-xs font-medium text-red-400/80 bg-surface-2/50 border border-red-400/30 hover:bg-surface-2 hover:text-red-400 hover:border-red-400/50 hover:cursor-pointer transition"
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <ConnectStravaLink />
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

        {/* Data Source Selector - only show when both Garmin and Strava are connected */}
        {(isGarminConnected && isStravaConnected) && (
          <div className="panel">
            <DataSourceSelector
              currentSource={activeDataSource}
              hasGarmin={isGarminConnected}
              hasStrava={isStravaConnected}
              onSelect={handleDataSourceSelect}
            />
          </div>
        )}

        {/* Duplicate Rides Management */}
        {(isGarminConnected || isStravaConnected) && (
          <div className="panel-spaced">
            <div>
              <p className="label-section">Data Management</p>
              <h2 className="title-section">Duplicate Rides</h2>
              <p className="text-sm text-muted mt-1">
                Manage duplicate rides that exist in both Garmin and Strava.
              </p>
            </div>
            <button
              onClick={() => setDuplicatesModalOpen(true)}
              className="btn-secondary max-w-md mx-auto"
            >
              Review Duplicates
            </button>
          </div>
        )}

        {/* Strava Bike Mapping */}
        {isStravaConnected && (
          <div className="panel-spaced">
            <div>
              <p className="label-section">Strava Integration</p>
              <h2 className="title-section">Bike Mapping</h2>
              <p className="text-sm text-muted mt-1">
                Map your Strava bikes to Loam Logger bikes to track component hours.
                {(unmappedData?.unmappedStravaGears?.length ?? 0) > 0 && (
                  <span className="ml-2 text-amber-400">
                    ({unmappedData.unmappedStravaGears.length} unmapped)
                  </span>
                )}
              </p>
            </div>
            <button
              onClick={() => setStravaMappingModalOpen(true)}
              className="btn-secondary max-w-md mx-auto"
            >
              Manage Bike Mappings
            </button>
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
              <dd className="text-lg text-white">{user?.name ?? "Unknown rider"}</dd>
            </div>
            <div>
              <dt className="text-muted uppercase tracking-[0.3em] text-xs">Email</dt>
              <dd className="text-lg text-white">{user?.email ?? "—"}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="panel-spaced xl:max-w-[calc(50%-0.75rem)]">
        <div>
          <p className="label-section">Preferences</p>
          <h2 className="title-section">Component hours display</h2>
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
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSavePreferences}
            disabled={preferenceSaving || hoursDisplay === savedHoursDisplay}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {preferenceSaving ? 'Saving...' : 'Save Preferences'}
          </button>
          {hoursDisplay !== savedHoursDisplay && (
            <span className="text-xs text-amber-400">Unsaved changes</span>
          )}
        </div>
      </section>

      {successMessage && (
        <section className="alert alert-success-dark rounded-3xl p-6">
          <div className="flex items-start gap-3">
            <div className="text-success">✓</div>
            <div>
              <h3 className="font-semibold">{successMessage}</h3>
            </div>
          </div>
        </section>
      )}

      <section className="panel-danger">
        <div>
          <p className="label-section text-danger">Danger Zone</p>
          <h2 className="title-section">Delete Account</h2>
        </div>
        <p className="text-body-muted">
          Permanently delete your account and all associated data. This action cannot be undone.
        </p>
        <button
          onClick={() => setDeleteModalOpen(true)}
          className="btn-danger"
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
        onDuplicatesFound={() => {
          setDuplicatesModalOpen(true);
        }}
      />

      <StravaImportModal
        open={stravaImportModalOpen}
        onClose={() => setStravaImportModalOpen(false)}
        onSuccess={() => {
          setSuccessMessage('Rides imported from Strava successfully!');
          setTimeout(() => setSuccessMessage(null), 8000);
        }}
        onDuplicatesFound={() => {
          setDuplicatesModalOpen(true);
        }}
      />

      <DuplicateRidesModal
        open={duplicatesModalOpen}
        onClose={() => setDuplicatesModalOpen(false)}
      />

      {(unmappedData?.unmappedStravaGears?.length ?? 0) > 0 && (
        <StravaGearMappingModal
          open={stravaMappingModalOpen}
          onClose={() => setStravaMappingModalOpen(false)}
          onSuccess={() => {
            refetchUnmapped();
            setSuccessMessage('Strava bike mapped successfully!');
            setTimeout(() => setSuccessMessage(null), 5000);
          }}
          unmappedGears={unmappedData.unmappedStravaGears}
          trigger="settings"
        />
      )}
    </div>
  );
}
