import { Sparkles } from 'lucide-react';
import type { AdvisorSummary } from '../../types/prediction';

interface AdvisorSummaryCardProps {
  summary: AdvisorSummary | null;
}

/**
 * Pro-only LLM maintenance summary for the priority-bike hero.
 *
 * The API null-gates this field (free tier, empty bike, ALL_GOOD trivial
 * state, rate-limit, or generation error all yield null), so the client rule
 * is simply: render nothing when null and let the space collapse. No tier
 * check here — mirrors how the rest of the hero treats null predictive fields.
 */
export function AdvisorSummaryCard({ summary }: AdvisorSummaryCardProps) {
  if (!summary) return null;

  return (
    <aside className="advisor-summary" aria-label="AI maintenance summary">
      <div className="advisor-summary-label">
        <Sparkles size={12} className="icon-left" />
        AI summary
      </div>
      <p className="advisor-summary-text">{summary.text}</p>
    </aside>
  );
}
