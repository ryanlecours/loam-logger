import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useResetCalibration } from '../../../graphql/calibration';
import SettingsSectionHeader from '../SettingsSectionHeader';

export default function MaintenanceSection() {
  const navigate = useNavigate();
  const [resetCalibration] = useResetCalibration();

  const handleReset = async () => {
    try {
      await resetCalibration();
      navigate('/dashboard');
    } catch (err) {
      console.error('Failed to reset calibration:', err);
      toast.error("Couldn't start calibration", {
        description: err instanceof Error ? err.message : 'Please try again.',
      });
    }
  };

  return (
    <div className="space-y-6">
      <SettingsSectionHeader
        eyebrow="Maintenance"
        title="Re-calibrate Components"
        description="If your component service status looks incorrect (e.g., after importing ride history), you can re-calibrate to set accurate service dates for your components."
      />
      <div className="panel-spaced">
        <div>
          <p className="label-section">Calibration</p>
          <h2 className="title-section">Reset and re-calibrate</h2>
          <p className="text-sm text-muted mt-1">
            Walk through calibration to confirm when each component was last serviced.
          </p>
        </div>
        <button type="button" onClick={handleReset} className="btn-secondary">
          Open Calibration
        </button>
      </div>
    </div>
  );
}
