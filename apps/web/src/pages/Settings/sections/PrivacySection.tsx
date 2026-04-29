import PrivacySettings from '../../../components/PrivacySettings';
import SettingsSectionHeader from '../SettingsSectionHeader';

export default function PrivacySection() {
  return (
    <div className="space-y-6">
      <SettingsSectionHeader
        eyebrow="Privacy"
        title="Data & analytics"
        description="Control how Loam Logger collects product-usage analytics."
      />
      <PrivacySettings />
    </div>
  );
}
