import PrivacySettings from '../../../components/PrivacySettings';
import SettingsSectionHeader from '../SettingsSectionHeader';
import MaintenanceExportPanel from './MaintenanceExportPanel';

export default function PrivacySection() {
  return (
    <div className="space-y-6">
      <SettingsSectionHeader
        eyebrow="Privacy"
        title="Data & analytics"
        description="Control how Loam Logger collects product-usage analytics, and take your own records with you."
      />
      <PrivacySettings />
      <MaintenanceExportPanel />
    </div>
  );
}
