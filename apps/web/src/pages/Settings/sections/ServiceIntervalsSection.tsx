import ServicePreferencesEditor from '../../../components/ServicePreferencesEditor';
import SettingsSectionHeader from '../SettingsSectionHeader';

export default function ServiceIntervalsSection() {
  return (
    <div className="space-y-6">
      <SettingsSectionHeader
        eyebrow="Service Tracking"
        title="Component Service Intervals"
        description="Configure which components to track and customize service intervals. These settings apply to all your bikes."
      />
      <div className="panel-spaced">
        <ServicePreferencesEditor />
      </div>
    </div>
  );
}
