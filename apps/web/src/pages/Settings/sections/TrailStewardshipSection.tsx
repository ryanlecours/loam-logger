import { useState } from 'react';
import { useQuery, gql } from '@apollo/client';
import { Shield, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import {
  STEWARDSHIP_HEADER,
  TRAIL_STEWARDSHIP_PROVIDERS,
  type StewardshipProviderId,
} from '@loam/shared';
import SettingsSectionHeader from '../SettingsSectionHeader';
import { STEWARDSHIP_BRAND_COLOR_VARS } from '../components/trailStewardshipBrandColors';

const STEWARDSHIP_ACCOUNTS_QUERY = gql`
  query StewardshipAccounts {
    me {
      id
      accounts {
        provider
      }
    }
  }
`;

type AccountRow = { provider: string };

/**
 * "Don't blow up the spot" stewardship recommendations for each connected
 * fitness provider on web. Mirrors the mobile section. Renders only the
 * providers the user has connected; suppresses the alarming header copy
 * when the only connection is WHOOP (which doesn't publish heat maps).
 */
export default function TrailStewardshipSection() {
  const { data, loading } = useQuery<{ me: { accounts: AccountRow[] } }>(
    STEWARDSHIP_ACCOUNTS_QUERY,
    { fetchPolicy: 'cache-and-network' },
  );

  const [expanded, setExpanded] = useState<StewardshipProviderId | null>(null);

  const connected = new Set((data?.me?.accounts ?? []).map((a) => a.provider));
  const visibleProviders = TRAIL_STEWARDSHIP_PROVIDERS.filter((p) => connected.has(p.provider));
  const anyHasHeatmap = visibleProviders.some((p) => p.hasPublicHeatmap);

  return (
    <div className="space-y-6">
      <SettingsSectionHeader
        eyebrow="Privacy"
        title="Trail Stewardship"
        description="Recommendations to keep your regular trails and home patterns off public heat maps."
      />

      {loading && !data ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading providers">
          <div className="skeleton skeleton-row" />
          <div className="skeleton skeleton-row" />
        </div>
      ) : visibleProviders.length === 0 ? (
        <div className="panel">
          <p className="text-sm text-muted">
            Connect a fitness provider in Data Sources to see stewardship recommendations.
          </p>
        </div>
      ) : (
        <>
          {anyHasHeatmap && (
            <div className="panel-spaced bg-amber-500/5 border-amber-500/30">
              <div className="flex items-start gap-3">
                <Shield className="h-5 w-5 shrink-0 text-amber-400 mt-0.5" />
                <div>
                  <p className="font-semibold text-amber-300">{STEWARDSHIP_HEADER.title}</p>
                  <p className="text-sm text-muted mt-1 leading-relaxed">
                    {STEWARDSHIP_HEADER.body}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-3">
            {visibleProviders.map((provider) => {
              const isExpanded = expanded === provider.provider;
              const brandColor = `var(${STEWARDSHIP_BRAND_COLOR_VARS[provider.provider]})`;

              if (!provider.hasPublicHeatmap) {
                return (
                  <div
                    key={provider.provider}
                    className="rounded-2xl border border-app/70 bg-surface-2 px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
                      <div>
                        <p className="font-semibold" style={{ color: brandColor }}>
                          {provider.name}
                        </p>
                        <p className="text-sm text-muted">{provider.summary}</p>
                      </div>
                    </div>
                  </div>
                );
              }

              const panelId = `stewardship-panel-${provider.provider}`;
              return (
                <div
                  key={provider.provider}
                  className="rounded-2xl border border-app/70 bg-surface-2 overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => setExpanded(isExpanded ? null : provider.provider)}
                    className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-surface-3/40 transition"
                    aria-expanded={isExpanded}
                    aria-controls={panelId}
                  >
                    <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
                    <div className="flex-1">
                      <p className="font-semibold" style={{ color: brandColor }}>
                        {provider.name}
                      </p>
                      <p className="text-sm text-muted">{provider.summary}</p>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 shrink-0 text-muted" />
                    ) : (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
                    )}
                  </button>

                  {isExpanded && (
                    <div id={panelId} className="border-t border-app/50 px-4 py-3 space-y-3">
                      <p className="label-section">How to opt out</p>
                      <ol className="space-y-2 text-sm">
                        {provider.steps.map((step, i) => (
                          <li key={step} className="flex gap-3">
                            <span className="font-semibold text-muted shrink-0 w-5">
                              {i + 1}.
                            </span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ol>
                      <a
                        href={provider.settingsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-medium hover:bg-surface-3/40 transition"
                        style={{ borderColor: brandColor, color: brandColor }}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Open {provider.name} privacy settings
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
