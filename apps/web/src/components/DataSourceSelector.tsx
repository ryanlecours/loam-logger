import { FaMountain, FaStrava } from 'react-icons/fa';

type Props = {
  currentSource: 'garmin' | 'strava' | null;
  hasGarmin: boolean;
  hasStrava: boolean;
  onSelect: (provider: 'garmin' | 'strava') => void;
};

export default function DataSourceSelector({ currentSource, hasGarmin, hasStrava, onSelect }: Props) {
  if (!hasGarmin || !hasStrava) {
    return null; // Only show if both providers are connected
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="label-section">Data Source</p>
        <h2 className="title-section">Active Provider</h2>
        <p className="text-body-muted mt-1">
          Choose which provider to sync activities from. Only one can be active at a time.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Garmin Card */}
        <button
          onClick={() => onSelect('garmin')}
          className={`relative flex flex-col items-center gap-3 p-6 rounded-2xl border-2 transition ${
            currentSource === 'garmin'
              ? 'border-[#11A9ED] bg-[#11A9ED]/20 ring-2 ring-[#11A9ED]/50'
              : 'border-app/50 bg-surface-2/50 hover:border-[#11A9ED]/50 hover:bg-[#11A9ED]/10'
          }`}
        >
          {currentSource === 'garmin' && (
            <div className="absolute top-3 right-3 flex items-center gap-1 text-xs font-semibold text-[#11A9ED]">
              <span>✓</span>
              <span>Active</span>
            </div>
          )}

          <FaMountain size={32} className={currentSource === 'garmin' ? 'text-[#11A9ED]' : 'text-muted'} />
          <div className="text-center">
            <p className="font-semibold">Garmin</p>
            <p className="text-xs text-muted mt-1">
              Sync from Garmin Connect
            </p>
          </div>
        </button>

        {/* Strava Card */}
        <button
          onClick={() => onSelect('strava')}
          className={`relative flex flex-col items-center gap-3 p-6 rounded-2xl border-2 transition ${
            currentSource === 'strava'
              ? 'border-[#FC4C02] bg-[#FC4C02]/20 ring-2 ring-[#FC4C02]/50'
              : 'border-app/50 bg-surface-2/50 hover:border-[#FC4C02]/50 hover:bg-[#FC4C02]/10'
          }`}
        >
          {currentSource === 'strava' && (
            <div className="absolute top-3 right-3 flex items-center gap-1 text-xs font-semibold text-[#FC4C02]">
              <span>✓</span>
              <span>Active</span>
            </div>
          )}

          <FaStrava size={32} className={currentSource === 'strava' ? 'text-[#FC4C02]' : 'text-muted'} />
          <div className="text-center">
            <p className="font-semibold">Strava</p>
            <p className="text-xs text-muted mt-1">
              Sync from Strava
            </p>
          </div>
        </button>
      </div>

      {!currentSource && (
        <div className="alert-warning-dark">
          <p className="text-sm">
            ⚠ Please select a data source to continue syncing activities
          </p>
        </div>
      )}
    </div>
  );
}
