import { useEffect, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApolloClient } from '@apollo/client';
import { toast } from 'sonner';
import SettingsShell from './SettingsShell';
import AccountSection from './sections/AccountSection';
import DataSourcesSection from './sections/DataSourcesSection';
import TrailStewardshipSection from './sections/TrailStewardshipSection';
import PreferencesSection from './sections/PreferencesSection';
import ServiceIntervalsSection from './sections/ServiceIntervalsSection';
import MaintenanceSection from './sections/MaintenanceSection';
import PrivacySection from './sections/PrivacySection';
import DangerZoneSection from './sections/DangerZoneSection';
import TrailStewardshipModal from './components/TrailStewardshipModal';
import type { SettingsSectionId } from './useSettingsSection';
import { DATA_SOURCES, PROVIDER_LABELS, type DataSource } from './providers';
import { useViewer } from '../../graphql/me';
import type { StewardshipProviderId } from '@loam/shared';

// Heatmap-publishing providers. Connecting any of these for the first time
// triggers the stewardship modal. Typed as ReadonlySet<StewardshipProviderId>
// so the `isHeatmapProvider` guard can narrow a DataSource into the
// shared-library type without an `as` cast at the call site.
const HEATMAP_PROVIDERS: ReadonlySet<StewardshipProviderId> = new Set([
  'strava',
  'garmin',
  'suunto',
]);

function isHeatmapProvider(p: DataSource): p is DataSource & StewardshipProviderId {
  return (HEATMAP_PROVIDERS as ReadonlySet<string>).has(p);
}

/**
 * Refetches ConnectedAccounts queries after an OAuth callback. Can't use a
 * hook here because this runs inside an effect in a separate component tree
 * slice; Apollo's `refetchQueries` on the client handles it.
 *
 * Also returns the provider that was just connected (if any) so the parent
 * can decide whether to surface a follow-up UI like the stewardship modal.
 */
function useOAuthCallback(): { justConnected: DataSource | null } {
  const [searchParams, setSearchParams] = useSearchParams();
  const apollo = useApolloClient();
  const [justConnected, setJustConnected] = useState<DataSource | null>(null);

  useEffect(() => {
    const connectedProvider = DATA_SOURCES.find(
      (p) => searchParams.get(p) === 'connected',
    );
    if (!connectedProvider) return;

    const label = PROVIDER_LABELS[connectedProvider];
    const prompt = searchParams.get('prompt');

    // Refetch any active ConnectedAccounts queries.
    apollo.refetchQueries({ include: ['ConnectedAccounts', 'AccountsForPasswordSection'] });

    if (prompt === 'choose-source') {
      toast.success(`${label} connected`, {
        description: 'Choose your active data source below.',
      });
    } else {
      toast.success(`${label} connected`);
    }

    setJustConnected(connectedProvider);

    // Strip only the OAuth keys. Crucially, preserve `section` and any other
    // params so deep links and the sidebar state survive the redirect.
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        for (const p of DATA_SOURCES) n.delete(p);
        n.delete('prompt');
        // Land the user on the Data Sources pane when arriving from OAuth.
        if (!n.get('section')) n.set('section', 'data-sources');
        return n;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams, apollo]);

  return { justConnected };
}

const SECTION_COMPONENTS: Record<SettingsSectionId, () => ReactElement> = {
  account: AccountSection,
  'data-sources': DataSourcesSection,
  'trail-stewardship': TrailStewardshipSection,
  preferences: PreferencesSection,
  'service-intervals': ServiceIntervalsSection,
  maintenance: MaintenanceSection,
  privacy: PrivacySection,
  danger: DangerZoneSection,
};

export default function Settings() {
  const { justConnected } = useOAuthCallback();
  const { viewer } = useViewer();

  // Show the stewardship modal once, after a heatmap-publishing provider is
  // connected for the first time. Server-backed flag keeps it cross-device.
  const [stewardshipModalOpen, setStewardshipModalOpen] = useState(false);
  const [stewardshipProvider, setStewardshipProvider] =
    useState<StewardshipProviderId | null>(null);

  useEffect(() => {
    if (!justConnected) return;
    if (!isHeatmapProvider(justConnected)) return;
    if (viewer?.trailStewardshipNoticeSeenAt) return;
    setStewardshipProvider(justConnected);
    setStewardshipModalOpen(true);
  }, [justConnected, viewer?.trailStewardshipNoticeSeenAt]);

  return (
    <>
      <SettingsShell>
        {(section) => {
          const Section = SECTION_COMPONENTS[section];
          return <Section />;
        }}
      </SettingsShell>
      <TrailStewardshipModal
        isOpen={stewardshipModalOpen}
        provider={stewardshipProvider}
        onClose={() => setStewardshipModalOpen(false)}
      />
    </>
  );
}
