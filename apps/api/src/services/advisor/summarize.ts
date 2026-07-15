/**
 * Maintenance-summary LLM caller.
 *
 * Single Anthropic call with the full predictions payload embedded — NO tool
 * loop. The resolver hands us the predictions directly, so tool discovery /
 * dynamic dispatch would be pure overhead here. See summarize.py for the
 * Python original that PR 2's offline eval scored.
 *
 * CANONICAL PROMPT: loam-agent-evals/summarize_prompt.py
 * Kept in sync by hand (verbatim string copy). Any change here must land there
 * or the offline eval stops representing prod behavior.
 */

import Anthropic from '@anthropic-ai/sdk';
import { logError, logger } from '../../lib/logger';
import type { BikePredictionSummary } from '../prediction/types';

export const DEFAULT_ADVISOR_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 300;

// Lazy, memoized client. Constructing new Anthropic() at module load
// would throw synchronously when ANTHROPIC_API_KEY is unset — and since
// this module is statically imported from resolvers.ts, that would
// prevent the whole API from booting on any env (local dev, preview,
// staging, CI) that hasn't provisioned the key. We defer construction
// to first-use and return null on missing key so the field resolver's
// existing null-fallback path just renders no widget instead.
let _client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

// Verbatim copy of loam-agent-evals/summarize_prompt.py:SUMMARY_SYSTEM_PROMPT.
// Do not diverge without landing the same change in Python — the offline eval
// is the regression harness for this string.
const SUMMARY_SYSTEM_PROMPT = `You are the maintenance advisor inside the Loam Logger app.

You receive one bike's full predictions payload (component list with statuses, hours since service, service intervals, hoursRemaining, and a priorityComponent). Your job is to produce ONE short natural-language summary the rider will see at the top of the bike-detail screen.

Rules:
- Length: one or two complete sentences. Never more. End the thought — do not truncate.
- Ground every specific claim in the payload. Never invent a number, a status, or a component. Never substitute an industry-standard service interval for the rider's configured one.
- Lead with the priorityComponent when present — the rider wants the most-urgent-thing first. If everything is ALL_GOOD, say so and cite the next-up component's hoursRemaining.
- Component naming (critical):
  - When you mention a brake component, ALWAYS specify which part: "brake pads", "brake rotors", or "brake calipers". NEVER say the bare word "brakes" — riders read that ambiguously.
  - Use lowercase natural-English names ("bottom bracket", "fork", "dropper post"). Do not use ENUM_CASE.
  - Include the location ("front", "rear") when the component has one.
- Numbers: state hoursSinceService and serviceIntervalHours only when they add information the status word doesn't (e.g. "overdue by 45 hours" is useful; restating "at 43 hours of a 250 hour interval" for an ALL_GOOD component is noise).
- Tone: direct, factual, no exclamation marks, no emoji. The rider is checking whether their bike is ready to ride; treat them like an adult.
- Do not offer opinions ("I recommend...", "you should..."). State the maintenance situation; let the rider decide.

Output ONLY the summary sentence(s). No preamble, no sign-off, no formatting.`;

export interface AdvisorSummaryResult {
  text: string;
  modelVersion: string;
  generatedAt: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
}

/**
 * Generate a one-to-two-sentence summary from a bike's predictions payload.
 * Returns null on any Anthropic error so the field resolver can render
 * nothing rather than surface partial or garbled prose to the rider.
 */
export async function generateSummary(
  predictions: BikePredictionSummary,
  model: string = DEFAULT_ADVISOR_MODEL,
): Promise<AdvisorSummaryResult | null> {
  const client = getClient();
  if (!client) {
    // Key not set in this env — surface once at info level (not warn:
    // deliberate config choice, not a bug) and return null so the widget
    // renders nothing.
    logger.info('[advisor] ANTHROPIC_API_KEY not set; skipping summary generation');
    return null;
  }

  const userContent =
    'Bike predictions payload:\n\n' + JSON.stringify(predictions, null, 2);

  const start = Date.now();
  try {
    const resp = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: SUMMARY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });
    // Sonnet may return ThinkingBlock alongside TextBlock. Filter to text only,
    // same treatment as loam-agent-evals/summarize.py.
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!text) {
      logger.warn({ model }, '[advisor] empty text after filtering blocks');
      return null;
    }
    return {
      text,
      modelVersion: model,
      generatedAt: new Date().toISOString(),
      promptTokens: resp.usage.input_tokens,
      completionTokens: resp.usage.output_tokens,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    logError('advisor.generateSummary', err);
    return null;
  }
}
