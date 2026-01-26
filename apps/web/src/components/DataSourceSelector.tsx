import { FaMountain, FaStrava } from 'react-icons/fa';
import { TbActivityHeartbeat } from 'react-icons/tb';

type Props = {
  currentSource: 'garmin' | 'strava' | 'whoop' | null;
  hasGarmin: boolean;
  hasStrava: boolean;
  hasWhoop?: boolean;
  onSelect: (provider: 'garmin' | 'strava' | 'whoop') => void;
};

export default function DataSourceSelector({ currentSource, hasGarmin, hasStrava, hasWhoop = false, onSelect }: Props) {
  // Count connected providers
  const connectedCount = [hasGarmin, hasStrava, hasWhoop].filter(Boolean).length;

  if (connectedCount < 2) {
    return null; // Only show if multiple providers are connected
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

      <div className={`grid gap-4 ${connectedCount === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {/* Garmin Card */}
        {hasGarmin && (
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
        )}

        {/* Strava Card */}
        {hasStrava && (
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
        )}

        {/* WHOOP Card */}
        {hasWhoop && (
          <button
            onClick={() => onSelect('whoop')}
            className={`relative flex flex-col items-center gap-3 p-6 rounded-2xl border-2 transition ${
              currentSource === 'whoop'
                ? 'border-[#00FF87] bg-[#00FF87]/20 ring-2 ring-[#00FF87]/50'
                : 'border-app/50 bg-surface-2/50 hover:border-[#00FF87]/50 hover:bg-[#00FF87]/10'
            }`}
          >
            {currentSource === 'whoop' && (
              <div className="absolute top-3 right-3 flex items-center gap-1 text-xs font-semibold text-[#00FF87]">
                <span>✓</span>
                <span>Active</span>
              </div>
            )}

            <TbActivityHeartbeat size={32} className={currentSource === 'whoop' ? 'text-[#00FF87]' : 'text-muted'} />
            <div className="text-center">
              <p className="font-semibold">WHOOP</p>
              <p className="text-xs text-muted mt-1">
                Sync from WHOOP
              </p>
            </div>
          </button>
        )}
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
