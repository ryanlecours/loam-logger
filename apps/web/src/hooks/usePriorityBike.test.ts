import { describe, it, expect } from 'vitest';
import { getTopDueComponents } from './usePriorityBike';
import type { BikePredictionSummary, ComponentPrediction, PredictionStatus } from '../types/prediction';

describe('getTopDueComponents', () => {
  const createComponent = (
    overrides: Partial<ComponentPrediction> = {}
  ): ComponentPrediction => ({
    componentId: `comp-${Math.random().toString(36).slice(2)}`,
    componentType: 'FORK',
    location: 'NONE',
    brand: 'RockShox',
    model: 'Pike',
    status: 'ALL_GOOD',
    hoursRemaining: 100,
    ridesRemainingEstimate: 20,
    confidence: 'HIGH',
    currentHours: 50,
    serviceIntervalHours: 150,
    hoursSinceService: 50,
    why: null,
    drivers: null,
    ...overrides,
  });

  const createPredictions = (
    components: ComponentPrediction[],
    overrides: Partial<BikePredictionSummary> = {}
  ): BikePredictionSummary => ({
    bikeId: 'bike-1',
    bikeName: 'Test Bike',
    components,
    priorityComponent: components[0] ?? null,
    overallStatus: 'ALL_GOOD',
    dueNowCount: 0,
    dueSoonCount: 0,
    generatedAt: new Date().toISOString(),
    ...overrides,
  });

  describe('null and empty inputs', () => {
    it('returns empty array for null predictions', () => {
      expect(getTopDueComponents(null)).toEqual([]);
    });

    it('returns empty array for predictions with no components', () => {
      const predictions = createPredictions([]);
      expect(getTopDueComponents(predictions)).toEqual([]);
    });

    it('returns empty array for predictions with undefined components', () => {
      const predictions = { ...createPredictions([]), components: undefined } as unknown as BikePredictionSummary;
      expect(getTopDueComponents(predictions)).toEqual([]);
    });
  });

  describe('filtering urgent components', () => {
    it('returns only OVERDUE components when present', () => {
      const components = [
        createComponent({ componentId: 'overdue-1', status: 'OVERDUE', hoursRemaining: -10 }),
        createComponent({ componentId: 'good-1', status: 'ALL_GOOD', hoursRemaining: 100 }),
      ];
      const predictions = createPredictions(components);

      const result = getTopDueComponents(predictions);

      expect(result).toHaveLength(1);
      expect(result[0].componentId).toBe('overdue-1');
    });

    it('returns only DUE_NOW components when no OVERDUE', () => {
      const components = [
        createComponent({ componentId: 'due-now-1', status: 'DUE_NOW', hoursRemaining: 5 }),
        createComponent({ componentId: 'good-1', status: 'ALL_GOOD', hoursRemaining: 100 }),
      ];
      const predictions = createPredictions(components);

      const result = getTopDueComponents(predictions);

      expect(result).toHaveLength(1);
      expect(result[0].componentId).toBe('due-now-1');
    });

    it('returns only DUE_SOON components when no OVERDUE or DUE_NOW', () => {
      const components = [
        createComponent({ componentId: 'due-soon-1', status: 'DUE_SOON', hoursRemaining: 20 }),
        createComponent({ componentId: 'good-1', status: 'ALL_GOOD', hoursRemaining: 100 }),
      ];
      const predictions = createPredictions(components);

      const result = getTopDueComponents(predictions);

      expect(result).toHaveLength(1);
      expect(result[0].componentId).toBe('due-soon-1');
    });

    it('returns ALL_GOOD components when no urgent components exist', () => {
      const components = [
        createComponent({ componentId: 'good-1', status: 'ALL_GOOD', hoursRemaining: 100 }),
        createComponent({ componentId: 'good-2', status: 'ALL_GOOD', hoursRemaining: 150 }),
      ];
      const predictions = createPredictions(components);

      const result = getTopDueComponents(predictions);

      expect(result).toHaveLength(2);
    });

    it('includes all urgent statuses (OVERDUE, DUE_NOW, DUE_SOON)', () => {
      const components = [
        createComponent({ componentId: 'overdue', status: 'OVERDUE', hoursRemaining: -10 }),
        createComponent({ componentId: 'due-now', status: 'DUE_NOW', hoursRemaining: 5 }),
        createComponent({ componentId: 'due-soon', status: 'DUE_SOON', hoursRemaining: 20 }),
        createComponent({ componentId: 'good', status: 'ALL_GOOD', hoursRemaining: 100 }),
      ];
      const predictions = createPredictions(components);

      const result = getTopDueComponents(predictions, 10);

      expect(result).toHaveLength(3);
      expect(result.map((c) => c.componentId)).toEqual(['overdue', 'due-now', 'due-soon']);
    });
  });

  describe('sorting', () => {
    it('sorts by severity (OVERDUE > DUE_NOW > DUE_SOON > ALL_GOOD)', () => {
      const components = [
        createComponent({ componentId: 'due-soon', status: 'DUE_SOON', hoursRemaining: 20 }),
        createComponent({ componentId: 'overdue', status: 'OVERDUE', hoursRemaining: -10 }),
        createComponent({ componentId: 'due-now', status: 'DUE_NOW', hoursRemaining: 5 }),
      ];
      const predictions = createPredictions(components);

      const result = getTopDueComponents(predictions);

      expect(result.map((c) => c.componentId)).toEqual(['overdue', 'due-now', 'due-soon']);
    });

    it('sorts by hoursRemaining within same severity (ascending)', () => {
      const components = [
        createComponent({ componentId: 'soon-50', status: 'DUE_SOON', hoursRemaining: 50 }),
        createComponent({ componentId: 'soon-10', status: 'DUE_SOON', hoursRemaining: 10 }),
        createComponent({ componentId: 'soon-30', status: 'DUE_SOON', hoursRemaining: 30 }),
      ];
      const predictions = createPredictions(components);

      const result = getTopDueComponents(predictions);

      expect(result.map((c) => c.componentId)).toEqual(['soon-10', 'soon-30', 'soon-50']);
    });

    it('handles mixed severity and hours remaining', () => {
      const components = [
        createComponent({ componentId: 'due-now-20', status: 'DUE_NOW', hoursRemaining: 20 }),
        createComponent({ componentId: 'overdue-5', status: 'OVERDUE', hoursRemaining: -5 }),
        createComponent({ componentId: 'overdue-10', status: 'OVERDUE', hoursRemaining: -10 }),
        createComponent({ componentId: 'due-now-5', status: 'DUE_NOW', hoursRemaining: 5 }),
      ];
      const predictions = createPredictions(components);

      // Request all 4 components to test full sorting
      const result = getTopDueComponents(predictions, 4);

      // First OVERDUE sorted by hours, then DUE_NOW sorted by hours
      expect(result.map((c) => c.componentId)).toEqual([
        'overdue-10', // most overdue (lowest/most negative hours)
        'overdue-5',
        'due-now-5', // lowest hours remaining in DUE_NOW
        'due-now-20',
      ]);
    });
  });

  describe('count parameter', () => {
    it('returns default of 3 components', () => {
      const components = [
        createComponent({ componentId: '1', status: 'DUE_SOON', hoursRemaining: 10 }),
        createComponent({ componentId: '2', status: 'DUE_SOON', hoursRemaining: 20 }),
        createComponent({ componentId: '3', status: 'DUE_SOON', hoursRemaining: 30 }),
        createComponent({ componentId: '4', status: 'DUE_SOON', hoursRemaining: 40 }),
        createComponent({ componentId: '5', status: 'DUE_SOON', hoursRemaining: 50 }),
      ];
      const predictions = createPredictions(components);

      const result = getTopDueComponents(predictions);

      expect(result).toHaveLength(3);
    });

    it('respects custom count parameter', () => {
      const components = [
        createComponent({ componentId: '1', status: 'DUE_SOON', hoursRemaining: 10 }),
        createComponent({ componentId: '2', status: 'DUE_SOON', hoursRemaining: 20 }),
        createComponent({ componentId: '3', status: 'DUE_SOON', hoursRemaining: 30 }),
        createComponent({ componentId: '4', status: 'DUE_SOON', hoursRemaining: 40 }),
        createComponent({ componentId: '5', status: 'DUE_SOON', hoursRemaining: 50 }),
      ];
      const predictions = createPredictions(components);

      expect(getTopDueComponents(predictions, 1)).toHaveLength(1);
      expect(getTopDueComponents(predictions, 5)).toHaveLength(5);
      expect(getTopDueComponents(predictions, 10)).toHaveLength(5); // Only 5 available
    });

    it('returns fewer than count when not enough components', () => {
      const components = [
        createComponent({ componentId: '1', status: 'DUE_SOON', hoursRemaining: 10 }),
        createComponent({ componentId: '2', status: 'DUE_SOON', hoursRemaining: 20 }),
      ];
      const predictions = createPredictions(components);

      const result = getTopDueComponents(predictions, 5);

      expect(result).toHaveLength(2);
    });
  });

  describe('edge cases', () => {
    it('handles components with equal hoursRemaining', () => {
      const components = [
        createComponent({ componentId: 'a', status: 'DUE_SOON', hoursRemaining: 20 }),
        createComponent({ componentId: 'b', status: 'DUE_SOON', hoursRemaining: 20 }),
        createComponent({ componentId: 'c', status: 'DUE_SOON', hoursRemaining: 20 }),
      ];
      const predictions = createPredictions(components);

      const result = getTopDueComponents(predictions);

      expect(result).toHaveLength(3);
    });

    it('handles negative hoursRemaining (overdue components)', () => {
      const components = [
        createComponent({ componentId: 'very-overdue', status: 'OVERDUE', hoursRemaining: -100 }),
        createComponent({ componentId: 'slightly-overdue', status: 'OVERDUE', hoursRemaining: -5 }),
      ];
      const predictions = createPredictions(components);

      const result = getTopDueComponents(predictions);

      // Most overdue first (most negative)
      expect(result[0].componentId).toBe('very-overdue');
      expect(result[1].componentId).toBe('slightly-overdue');
    });

    it('handles zero hoursRemaining', () => {
      const components = [
        createComponent({ componentId: 'zero', status: 'DUE_NOW', hoursRemaining: 0 }),
        createComponent({ componentId: 'positive', status: 'DUE_NOW', hoursRemaining: 10 }),
      ];
      const predictions = createPredictions(components);

      const result = getTopDueComponents(predictions);

      expect(result[0].componentId).toBe('zero');
    });
  });
});
