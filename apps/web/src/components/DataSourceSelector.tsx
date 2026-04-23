import { Mountain, Activity } from 'lucide-react';
import { StravaIcon, SuuntoIcon } from './icons/BrandIcons';

type Props = {
  currentSource: 'garmin' | 'strava' | 'whoop' | 'suunto' | null;
  hasGarmin: boolean;
  hasStrava: boolean;
  hasWhoop?: boolean;
  hasSuunto?: boolean;
  onSelect: (provider: 'garmin' | 'strava' | 'whoop' | 'suunto') => void;
};

export default function DataSourceSelector({ currentSource, hasGarmin, hasStrava, hasWhoop = false, hasSuunto = false, onSelect }: Props) {
  // Count connected providers
  const connectedCount = [hasGarmin, hasStrava, hasWhoop, hasSuunto].filter(Boolean).length;

  if (connectedCount < 2) {
    return null; // Only show if multiple providers are connected
  }

  const gridCols = connectedCount >= 4 ? 'grid-cols-4' : connectedCount === 3 ? 'grid-cols-3' : 'grid-cols-2';

  return (
    <div className="space-y-4">
      <div>
        <p className="label-section">Data Source</p>
        <h2 className="title-section">Active Provider</h2>
        <p className="text-body-muted mt-1">
          Choose which provider to sync activities from. Only one can be active at a time.
        </p>
        <p className="text-body-muted mt-2 text-sm">
          Real-time ride uploads from the other connected providers are ignored while this is set.
          This prevents duplicate imports when, for example, your watch auto-uploads to both
          Strava and Garmin. You can switch at any time, or disconnect a provider entirely in
          the section above.
        </p>
      </div>

      <div className={`grid gap-4 ${gridCols}`}>
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

            <Mountain size={32} className={currentSource === 'garmin' ? 'text-[#11A9ED]' : 'text-muted'} />
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

            <StravaIcon size={32} className={currentSource === 'strava' ? 'text-[#FC4C02]' : 'text-muted'} />
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

            <Activity size={32} className={currentSource === 'whoop' ? 'text-[#00FF87]' : 'text-muted'} />
            <div className="text-center">
              <p className="font-semibold">WHOOP</p>
              <p className="text-xs text-muted mt-1">
                Sync from WHOOP
              </p>
            </div>
          </button>
        )}

        {/* Suunto Card */}
        {hasSuunto && (
          <button
            onClick={() => onSelect('suunto')}
            className={`relative flex flex-col items-center gap-3 p-6 rounded-2xl border-2 transition ${
              currentSource === 'suunto'
                ? 'border-[#0072CE] bg-[#0072CE]/20 ring-2 ring-[#0072CE]/50'
                : 'border-app/50 bg-surface-2/50 hover:border-[#0072CE]/50 hover:bg-[#0072CE]/10'
            }`}
          >
            {currentSource === 'suunto' && (
              <div className="absolute top-3 right-3 flex items-center gap-1 text-xs font-semibold text-[#0072CE]">
                <span>✓</span>
                <span>Active</span>
              </div>
            )}

            <SuuntoIcon size={32} className={currentSource === 'suunto' ? 'text-[#0072CE]' : 'text-muted'} />
            <div className="text-center">
              <p className="font-semibold">Suunto</p>
              <p className="text-xs text-muted mt-1">
                Sync from Suunto
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
