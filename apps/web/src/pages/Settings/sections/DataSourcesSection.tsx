import { useState } from 'react';
import { useQuery, gql } from '@apollo/client';
import { toast } from 'sonner';
import { Mountain, Activity } from 'lucide-react';
import { StravaIcon, GoogleIcon, SuuntoIcon } from '../../../components/icons/BrandIcons';
import ConnectGarminLink from '../../../components/ConnectGarminLink';
import ConnectStravaLink from '../../../components/ConnectStravaLink';
import ConnectSuuntoLink from '../../../components/ConnectSuuntoLink';
import ConnectWhoopLink from '../../../components/ConnectWhoopLink';
import GarminImportModal from '../../../components/GarminImportModal';
import StravaImportModal from '../../../components/StravaImportModal';
import WhoopImportModal from '../../../components/WhoopImportModal';
import SuuntoImportModal from '../../../components/SuuntoImportModal';
import StravaBikeMappingOverlay from '../../../components/StravaBikeMappingOverlay';
import DataSourceSelector from '../../../components/DataSourceSelector';
import DuplicateRidesModal from '../../../components/DuplicateRidesModal';
import WeatherBackfillSection from '../../../components/WeatherBackfillSection';
import { UNMAPPED_STRAVA_GEARS } from '../../../graphql/stravaGear';
import { useUserTier } from '../../../hooks/useUserTier';
import { getAuthHeaders } from '@/lib/csrf';
import SettingsSectionHeader from '../SettingsSectionHeader';
import ProviderCard from '../components/ProviderCard';
import ConfirmDialog from '../components/ConfirmDialog';
import { PROVIDER_LABELS, isDataSource, type DataSource } from '../providers';

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

type Account = { provider: string; connectedAt: string };

export default function DataSourcesSection() {
  const { isAdmin } = useUserTier();
  const { data: accountsData, loading: accountsLoading, refetch: refetchAccounts } = useQuery(
    CONNECTED_ACCOUNTS_QUERY,
    { fetchPolicy: 'cache-and-network' },
  );
  const { data: unmappedData, refetch: refetchUnmapped } = useQuery(UNMAPPED_STRAVA_GEARS, {
    fetchPolicy: 'cache-and-network',
  });

  const [garminImportOpen, setGarminImportOpen] = useState(false);
  const [stravaImportOpen, setStravaImportOpen] = useState(false);
  const [whoopImportOpen, setWhoopImportOpen] = useState(false);
  const [suuntoImportOpen, setSuuntoImportOpen] = useState(false);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [stravaMappingOpen, setStravaMappingOpen] = useState(false);
  const [garminDeleteLoading, setGarminDeleteLoading] = useState(false);
  const [stravaDeleteLoading, setStravaDeleteLoading] = useState(false);
  const [whoopDeleteLoading, setWhoopDeleteLoading] = useState(false);

  type ConfirmState =
    | { kind: 'disconnect'; provider: DataSource }
    | { kind: 'delete-rides'; provider: 'garmin' | 'strava' | 'whoop' }
    | null;
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);

  const accounts: Account[] = accountsData?.me?.accounts ?? [];
  const garminAccount = accounts.find((a) => a.provider === 'garmin');
  const stravaAccount = accounts.find((a) => a.provider === 'strava');
  const whoopAccount = accounts.find((a) => a.provider === 'whoop');
  const suuntoAccount = accounts.find((a) => a.provider === 'suunto');
  // The backend's activeDataSource is typed as the broader `AuthProvider`
  // enum (which also includes apple/google). Narrow at the boundary so a
  // future schema drift or unexpected value doesn't silently propagate as
  // a "valid" provider into PROVIDER_LABELS lookups, the selector UI, etc.
  const rawActiveDataSource = accountsData?.me?.activeDataSource ?? null;
  const activeDataSource: DataSource | null = isDataSource(rawActiveDataSource)
    ? rawActiveDataSource
    : null;
  const connectedCount = [garminAccount, stravaAccount, whoopAccount, suuntoAccount].filter(Boolean).length;

  const runDisconnect = async (provider: DataSource) => {
    const label = PROVIDER_LABELS[provider];
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/${provider}/disconnect`, {
        method: 'DELETE',
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to disconnect');
      await refetchAccounts();
      toast.success(`${label} disconnected`);
    } catch (err) {
      console.error(`Failed to disconnect ${label}:`, err);
      toast.error(`Failed to disconnect ${label}. Please try again.`);
      throw err;
    }
  };

  const runDeleteImportedRides = async (provider: 'garmin' | 'strava' | 'whoop') => {
    const label = PROVIDER_LABELS[provider];
    const setLoading =
      provider === 'garmin'
        ? setGarminDeleteLoading
        : provider === 'strava'
          ? setStravaDeleteLoading
          : setWhoopDeleteLoading;
    setLoading(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/${provider}/testing/delete-imported-rides`, {
        method: 'DELETE',
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error(`Failed to delete ${label} rides`);
      const data = await res.json();
      const deleted = Number(data.deletedRides || 0);
      toast.success(
        deleted > 0
          ? `Deleted ${deleted} ${label} ride${deleted === 1 ? '' : 's'} and reset component hours.`
          : `No ${label} rides found to delete.`,
      );
    } catch (err) {
      console.error(`Failed to delete ${label} rides:`, err);
      toast.error(`Failed to delete ${label} rides. Please try again.`);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const handleDataSourceSelect = async (provider: DataSource) => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/data-source/preference`, {
        method: 'POST',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: JSON.stringify({ provider }),
      });
      if (!res.ok) throw new Error('Failed to set data source');
      await refetchAccounts();
      toast.success(`Active data source set to ${provider.charAt(0).toUpperCase() + provider.slice(1)}`);
    } catch (err) {
      console.error('Failed to set data source:', err);
      toast.error('Failed to set data source. Please try again.');
    }
  };

  const unmappedCount = unmappedData?.unmappedStravaGears?.length ?? 0;

  return (
    <div className="space-y-6">
      <SettingsSectionHeader
        eyebrow="Data Sources"
        title="Connected services"
        description="Link Garmin, Strava, WHOOP, or Suunto to automatically log rides and keep your bike hours in sync."
      />

      <div className="panel-spaced">
        <div>
          <p className="label-section">Account Linking</p>
          <h2 className="title-section">Providers</h2>
        </div>
        {accountsLoading && !accountsData ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading connected providers">
            <div className="skeleton skeleton-row" />
            <div className="skeleton skeleton-row" />
            <div className="skeleton skeleton-row" />
            <div className="skeleton skeleton-row" />
          </div>
        ) : (
          <div className="space-y-3">
            {/* Google — always connected via login */}
            <div className="w-full rounded-2xl border border-app/70 bg-surface-2 px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <GoogleIcon className="text-lg text-blue-400" />
                  <div>
                    <p className="font-semibold">Google</p>
                    <p className="text-body-muted">Used for login</p>
                  </div>
                </div>
                <span className="text-xs text-success">Connected</span>
              </div>
            </div>

            {garminAccount ? (
              <ProviderCard
                icon={<Mountain />}
                displayName="Garmin Connect"
                brandColorVar="--brand-garmin"
                connectedAt={garminAccount.connectedAt}
                onSyncPrevious={() => setGarminImportOpen(true)}
                onDisconnect={() => setConfirmState({ kind: 'disconnect', provider: 'garmin' })}
                showAdminClear={isAdmin}
                onClearRides={() => setConfirmState({ kind: 'delete-rides', provider: 'garmin' })}
                clearRidesLoading={garminDeleteLoading}
                clearRidesLabel="Clear Garmin Rides"
              />
            ) : (
              <ConnectGarminLink />
            )}

            {stravaAccount ? (
              <ProviderCard
                icon={<StravaIcon />}
                displayName="Strava"
                brandColorVar="--brand-strava"
                connectedAt={stravaAccount.connectedAt}
                onSyncPrevious={() => setStravaImportOpen(true)}
                onDisconnect={() => setConfirmState({ kind: 'disconnect', provider: 'strava' })}
                showAdminClear={isAdmin}
                onClearRides={() => setConfirmState({ kind: 'delete-rides', provider: 'strava' })}
                clearRidesLoading={stravaDeleteLoading}
                clearRidesLabel="Clear Strava Rides"
              />
            ) : (
              <ConnectStravaLink />
            )}

            {whoopAccount ? (
              <ProviderCard
                icon={<Activity />}
                displayName="WHOOP"
                brandColorVar="--brand-whoop"
                connectedAt={whoopAccount.connectedAt}
                onSyncPrevious={() => setWhoopImportOpen(true)}
                onDisconnect={() => setConfirmState({ kind: 'disconnect', provider: 'whoop' })}
                showAdminClear={isAdmin}
                onClearRides={() => setConfirmState({ kind: 'delete-rides', provider: 'whoop' })}
                clearRidesLoading={whoopDeleteLoading}
                clearRidesLabel="Clear WHOOP Rides"
              />
            ) : (
              <ConnectWhoopLink />
            )}

            {suuntoAccount ? (
              <ProviderCard
                icon={<SuuntoIcon />}
                displayName="Suunto"
                brandColorVar="--brand-suunto"
                connectedAt={suuntoAccount.connectedAt}
                onSyncPrevious={() => setSuuntoImportOpen(true)}
                onDisconnect={() => setConfirmState({ kind: 'disconnect', provider: 'suunto' })}
              />
            ) : (
              <ConnectSuuntoLink />
            )}
          </div>
        )}
      </div>

      {connectedCount >= 2 && (
        <div className="panel">
          <DataSourceSelector
            currentSource={activeDataSource}
            hasGarmin={!!garminAccount}
            hasStrava={!!stravaAccount}
            hasWhoop={!!whoopAccount}
            hasSuunto={!!suuntoAccount}
            onSelect={handleDataSourceSelect}
          />
        </div>
      )}

      <WeatherBackfillSection />

      {(garminAccount || stravaAccount) && (
        <div className="panel-spaced">
          <div>
            <p className="label-section">Data Management</p>
            <h2 className="title-section">Duplicate Rides</h2>
            <p className="text-sm text-muted mt-1">
              Manage duplicate rides that exist in both Garmin and Strava.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDuplicatesOpen(true)}
            className="btn-secondary max-w-md"
          >
            Review Duplicates
          </button>
        </div>
      )}

      <div className="panel-spaced">
        <div>
          <p className="label-section">Strava Integration</p>
          <h2 className="title-section">Bike Mapping</h2>
          <p className="text-sm text-muted mt-1">
            {stravaAccount ? (
              <>
                Map your Strava bikes to Loam Logger bikes to track component hours.
                {unmappedCount > 0 && (
                  <span className="ml-2 text-amber-400">({unmappedCount} unmapped)</span>
                )}
              </>
            ) : (
              'Connect Strava to map your bikes and automatically assign rides.'
            )}
          </p>
        </div>
        {stravaAccount ? (
          <button
            type="button"
            onClick={() => setStravaMappingOpen(true)}
            className="btn-secondary max-w-md"
          >
            Manage Bike Mappings
          </button>
        ) : (
          <div className="max-w-md">
            <ConnectStravaLink />
          </div>
        )}
      </div>

      <GarminImportModal
        open={garminImportOpen}
        onClose={() => setGarminImportOpen(false)}
        onSuccess={() =>
          toast.success('Backfill triggered', {
            description: 'Your rides will sync automatically via Garmin webhooks.',
          })
        }
        onDuplicatesFound={() => setDuplicatesOpen(true)}
      />
      <StravaImportModal
        open={stravaImportOpen}
        onClose={() => setStravaImportOpen(false)}
        onSuccess={() => toast.success('Rides imported from Strava')}
        onDuplicatesFound={() => setDuplicatesOpen(true)}
      />
      <WhoopImportModal
        open={whoopImportOpen}
        onClose={() => setWhoopImportOpen(false)}
        onSuccess={() => toast.success('Rides imported from WHOOP')}
        onDuplicatesFound={() => setDuplicatesOpen(true)}
      />
      <SuuntoImportModal
        open={suuntoImportOpen}
        onClose={() => setSuuntoImportOpen(false)}
        onSuccess={() => toast.success('Rides imported from Suunto')}
        onDuplicatesFound={() => setDuplicatesOpen(true)}
      />
      <DuplicateRidesModal open={duplicatesOpen} onClose={() => setDuplicatesOpen(false)} />
      <StravaBikeMappingOverlay
        open={stravaMappingOpen}
        onClose={() => setStravaMappingOpen(false)}
        onSuccess={() => {
          refetchUnmapped();
          toast.success('Strava bike mapping updated');
        }}
      />

      <ConfirmDialog
        isOpen={confirmState?.kind === 'disconnect'}
        onClose={() => setConfirmState(null)}
        onConfirm={() => {
          if (confirmState?.kind !== 'disconnect') return Promise.resolve();
          return runDisconnect(confirmState.provider);
        }}
        title={
          confirmState?.kind === 'disconnect'
            ? `Disconnect ${PROVIDER_LABELS[confirmState.provider]}?`
            : 'Disconnect?'
        }
        description={
          confirmState?.kind === 'disconnect' ? (
            <>
              Your synced rides will remain, but new{' '}
              {confirmState.provider === 'whoop' || confirmState.provider === 'suunto'
                ? 'workouts'
                : 'activities'}{' '}
              will not sync.
            </>
          ) : null
        }
        confirmLabel="Disconnect"
        variant="danger"
      />

      <ConfirmDialog
        isOpen={confirmState?.kind === 'delete-rides'}
        onClose={() => setConfirmState(null)}
        onConfirm={() => {
          if (confirmState?.kind !== 'delete-rides') return Promise.resolve();
          return runDeleteImportedRides(confirmState.provider);
        }}
        title={
          confirmState?.kind === 'delete-rides'
            ? `Delete all ${PROVIDER_LABELS[confirmState.provider]} rides?`
            : 'Delete rides?'
        }
        description={
          confirmState?.kind === 'delete-rides' ? (
            <>
              This will remove every ride imported from {PROVIDER_LABELS[confirmState.provider]} and reset
              the hours those rides added to your bikes.
            </>
          ) : null
        }
        confirmLabel="Delete rides"
        variant="danger"
      />
    </div>
  );
}
