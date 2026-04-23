import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApolloClient } from '@apollo/client';
import { toast } from 'sonner';
import SettingsShell from './SettingsShell';
import AccountSection from './sections/AccountSection';
import DataSourcesSection from './sections/DataSourcesSection';
import PreferencesSection from './sections/PreferencesSection';
import ServiceIntervalsSection from './sections/ServiceIntervalsSection';
import MaintenanceSection from './sections/MaintenanceSection';
import PrivacySection from './sections/PrivacySection';
import DangerZoneSection from './sections/DangerZoneSection';
import type { SettingsSectionId } from './useSettingsSection';

type OAuthProvider = 'garmin' | 'strava' | 'whoop' | 'suunto';
const OAUTH_PROVIDERS: readonly OAuthProvider[] = ['garmin', 'strava', 'whoop', 'suunto'];

const PROVIDER_LABELS: Record<OAuthProvider, string> = {
  garmin: 'Garmin',
  strava: 'Strava',
  whoop: 'WHOOP',
  suunto: 'Suunto',
};

/**
 * Refetches ConnectedAccounts queries after an OAuth callback. Can't use a
 * hook here because this runs inside an effect in a separate component tree
 * slice; Apollo's `refetchQueries` on the client handles it.
 */
function useOAuthCallback() {
  const [searchParams, setSearchParams] = useSearchParams();
  const apollo = useApolloClient();

  useEffect(() => {
    const connectedProvider = OAUTH_PROVIDERS.find(
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

    // Strip only the OAuth keys. Crucially, preserve `section` and any other
    // params so deep links and the sidebar state survive the redirect.
    setSearchParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        for (const p of OAUTH_PROVIDERS) n.delete(p);
        n.delete('prompt');
        // Land the user on the Data Sources pane when arriving from OAuth.
        if (!n.get('section')) n.set('section', 'data-sources');
        return n;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams, apollo]);
}

const SECTION_COMPONENTS: Record<SettingsSectionId, () => React.ReactElement> = {
  account: AccountSection,
  'data-sources': DataSourcesSection,
  preferences: PreferencesSection,
  'service-intervals': ServiceIntervalsSection,
  maintenance: MaintenanceSection,
  privacy: PrivacySection,
  danger: DangerZoneSection,
};

export default function Settings() {
  useOAuthCallback();

  return (
    <SettingsShell>
      {(section) => {
        const Section = SECTION_COMPONENTS[section];
        return <Section />;
      }}
    </SettingsShell>
  );
}
