// Mock the Anthropic SDK before importing the module under test.
const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
});

// Ensure the module has an API key visible at import time.
process.env.ANTHROPIC_API_KEY = 'test-key';

import { generateSummary, DEFAULT_ADVISOR_MODEL } from './summarize';
import type { BikePredictionSummary } from '../prediction/types';

const mockPredictions: BikePredictionSummary = {
  bikeId: 'bike-1',
  bikeName: 'Spindrift',
  components: [
    {
      componentId: 'c-1',
      componentType: 'BRAKE_PAD',
      location: 'FRONT',
      brand: 'Stock',
      model: 'Brake Pads',
      status: 'OVERDUE',
      hoursRemaining: 0,
      ridesRemainingEstimate: 0,
      confidence: 'HIGH',
      currentHours: 45,
      serviceIntervalHours: 40,
      hoursSinceService: 45,
      ridesSinceService: 20,
      why: 'Overdue.',
    } as never,
  ],
  priorityComponent: null,
  overallStatus: 'OVERDUE',
  dueNowCount: 0,
  dueSoonCount: 0,
  generatedAt: new Date('2026-07-15T00:00:00Z'),
  algoVersion: 'v1',
};

describe('generateSummary', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('returns text + usage on a successful call', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Front brake pads are overdue.' }],
      usage: { input_tokens: 100, output_tokens: 20 },
    });
    const result = await generateSummary(mockPredictions);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('Front brake pads are overdue.');
    expect(result!.promptTokens).toBe(100);
    expect(result!.completionTokens).toBe(20);
    expect(result!.modelVersion).toBe(DEFAULT_ADVISOR_MODEL);
    expect(result!.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('honors an explicit model override', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await generateSummary(mockPredictions, 'claude-sonnet-5');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-5' })
    );
  });

  it('filters ThinkingBlock and keeps only text blocks', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        { type: 'thinking', thinking: 'reasoning...' },
        { type: 'text', text: 'The real summary.' },
      ],
      usage: { input_tokens: 100, output_tokens: 5 },
    });
    const result = await generateSummary(mockPredictions);
    expect(result!.text).toBe('The real summary.');
  });

  it('returns null when the model produces no text block', async () => {
    // Real Sonnet behavior — burns the token budget on thinking with no
    // TextBlock emerging. Widget must render nothing rather than empty prose.
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'thinking', thinking: 'reasoning...' }],
      usage: { input_tokens: 100, output_tokens: 300 },
    });
    const result = await generateSummary(mockPredictions);
    expect(result).toBeNull();
  });

  it('returns null on SDK error (network, 5xx, etc.)', async () => {
    mockCreate.mockRejectedValueOnce(new Error('anthropic 503'));
    const result = await generateSummary(mockPredictions);
    expect(result).toBeNull();
  });

  it('embeds the predictions payload in the user turn', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await generateSummary(mockPredictions);
    const call = mockCreate.mock.calls[0][0];
    expect(call.messages[0].role).toBe('user');
    expect(call.messages[0].content).toContain('Bike predictions payload');
    expect(call.messages[0].content).toContain('BRAKE_PAD');
  });

  it('carries the brake-naming rule in the system prompt', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await generateSummary(mockPredictions);
    const call = mockCreate.mock.calls[0][0];
    // The single most important guardrail from the offline eval — if it
    // gets dropped from the prompt, the whole PR 2 validation is invalid.
    expect(call.system).toMatch(/brake pads/);
    expect(call.system).toMatch(/brake rotors/);
    expect(call.system).toMatch(/brake calipers/);
    expect(call.system).toMatch(/never/i);
  });
});
