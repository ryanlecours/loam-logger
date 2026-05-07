import { Shield, ExternalLink } from 'lucide-react';
import { Modal } from '../../../components/ui/Modal';
import {
  STEWARDSHIP_HEADER,
  TRAIL_STEWARDSHIP_PROVIDERS,
  type StewardshipProviderId,
} from '@loam/shared';
import { useMarkTrailStewardshipNoticeSeen } from '../../../graphql/userPreferences';

const BRAND_COLOR_VARS: Record<StewardshipProviderId, string> = {
  strava: '--brand-strava',
  garmin: '--brand-garmin',
  suunto: '--brand-suunto',
  whoop: '--brand-whoop',
};

type Props = {
  isOpen: boolean;
  /** Provider that was just connected. Highlighted in the modal. */
  provider: StewardshipProviderId | null;
  onClose: () => void;
};

/**
 * One-time modal shown after a user connects their first heatmap-publishing
 * provider (Strava, Garmin, Suunto). Persists "seen" state server-side via
 * markTrailStewardshipNoticeSeen so the modal doesn't reappear on subsequent
 * connections, on any device.
 */
export default function TrailStewardshipModal({ isOpen, provider, onClose }: Props) {
  const [markSeen] = useMarkTrailStewardshipNoticeSeen();

  const focused = provider
    ? TRAIL_STEWARDSHIP_PROVIDERS.find((p) => p.provider === provider)
    : null;

  const handleDismiss = async () => {
    try {
      await markSeen();
    } catch {
      // Non-fatal. If the mutation fails the modal may show again on the next
      // connection; not worth blocking the user.
    }
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleDismiss}
      title={STEWARDSHIP_HEADER.title}
      size="md"
      footer={
        <button type="button" onClick={handleDismiss} className="btn-primary">
          I've reviewed my settings
        </button>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <Shield className="h-5 w-5 shrink-0 text-amber-400 mt-0.5" />
          <p className="text-sm text-muted leading-relaxed">{STEWARDSHIP_HEADER.body}</p>
        </div>

        {focused && focused.hasPublicHeatmap && (
          <div className="rounded-2xl border border-app/70 bg-surface-2 px-4 py-3 space-y-3">
            <div>
              <p
                className="font-semibold text-sm"
                style={{ color: `var(${BRAND_COLOR_VARS[focused.provider]})` }}
              >
                Just connected: {focused.name}
              </p>
              <p className="text-sm text-muted mt-1">{focused.summary}</p>
            </div>

            <div>
              <p className="label-section mb-2">How to opt out</p>
              <ol className="space-y-2 text-sm">
                {focused.steps.map((step, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="font-semibold text-muted shrink-0 w-5">{i + 1}.</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>

            <a
              href={focused.settingsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-medium hover:bg-surface-3/40 transition"
              style={{
                borderColor: `var(${BRAND_COLOR_VARS[focused.provider]})`,
                color: `var(${BRAND_COLOR_VARS[focused.provider]})`,
              }}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open {focused.name} privacy settings
            </a>
          </div>
        )}

        <p className="text-xs text-muted italic">
          You can revisit these instructions any time from Settings, Trail Stewardship.
        </p>
      </div>
    </Modal>
  );
}
