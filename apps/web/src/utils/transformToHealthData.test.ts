import { describe, it, expect } from 'vitest';
import {
  transformToHealthData,
  type BikeSummary,
  type ComponentSummary,
} from './transformToHealthData';

describe('transformToHealthData', () => {
  const createComponent = (
    overrides: Partial<ComponentSummary> = {}
  ): ComponentSummary => ({
    id: `comp-${Math.random().toString(36).slice(2)}`,
    type: 'FORK',
    brand: 'RockShox',
    model: 'Pike',
    hoursUsed: 25,
    serviceDueAtHours: 50,
    updatedAt: '2024-01-01T12:00:00Z',
    ...overrides,
  });

  const createBike = (overrides: Partial<BikeSummary> = {}): BikeSummary => ({
    id: `bike-${Math.random().toString(36).slice(2)}`,
    nickname: null,
    manufacturer: 'Trek',
    model: 'Fuel EX',
    thumbnailUrl: null,
    fork: null,
    shock: null,
    pivotBearings: null,
    components: [],
    ...overrides,
  });

  describe('empty and minimal inputs', () => {
    it('returns empty array for empty input', () => {
      expect(transformToHealthData([])).toEqual([]);
    });

    it('handles bike with no components', () => {
      const bike = createBike({ id: 'bike-1' });
      const result = transformToHealthData([bike]);

      expect(result).toHaveLength(1);
      expect(result[0].components).toHaveLength(0);
      expect(result[0].criticalCount).toBe(0);
      expect(result[0].warningCount).toBe(0);
      expect(result[0].isHealthy).toBe(true);
    });
  });

  describe('bike name derivation', () => {
    it('uses nickname when present', () => {
      const bike = createBike({
        nickname: 'The Beast',
        manufacturer: 'Santa Cruz',
        model: 'Hightower',
      });
      const result = transformToHealthData([bike]);

      expect(result[0].name).toBe('The Beast');
    });

    it('uses manufacturer + model when nickname is null', () => {
      const bike = createBike({
        nickname: null,
        manufacturer: 'Yeti',
        model: 'SB150',
      });
      const result = transformToHealthData([bike]);

      expect(result[0].name).toBe('Yeti SB150');
    });

    it('uses manufacturer + model when nickname is empty', () => {
      const bike = createBike({
        nickname: '',
        manufacturer: 'Specialized',
        model: 'Stumpjumper',
      });
      const result = transformToHealthData([bike]);

      expect(result[0].name).toBe('Specialized Stumpjumper');
    });

    it('trims whitespace from nickname', () => {
      const bike = createBike({
        nickname: '  My Bike  ',
        manufacturer: 'Trek',
        model: 'Fuel',
      });
      const result = transformToHealthData([bike]);

      expect(result[0].name).toBe('My Bike');
    });

    it('falls back to "Bike" when all name fields are empty', () => {
      const bike = createBike({
        nickname: '',
        manufacturer: '',
        model: '',
      });
      const result = transformToHealthData([bike]);

      expect(result[0].name).toBe('Bike');
    });
  });

  describe('component aggregation', () => {
    it('includes fork component', () => {
      const bike = createBike({
        fork: createComponent({ id: 'fork-1', type: 'FORK' }),
      });
      const result = transformToHealthData([bike]);

      expect(result[0].components).toHaveLength(1);
      expect(result[0].components[0].id).toBe('fork-1');
      expect(result[0].components[0].label).toBe('Fork');
    });

    it('includes shock component', () => {
      const bike = createBike({
        shock: createComponent({ id: 'shock-1', type: 'SHOCK' }),
      });
      const result = transformToHealthData([bike]);

      expect(result[0].components).toHaveLength(1);
      expect(result[0].components[0].id).toBe('shock-1');
      expect(result[0].components[0].label).toBe('Rear Shock');
    });

    it('includes pivotBearings component', () => {
      const bike = createBike({
        pivotBearings: createComponent({ id: 'pivot-1', type: 'PIVOT_BEARINGS' }),
      });
      const result = transformToHealthData([bike]);

      expect(result[0].components).toHaveLength(1);
      expect(result[0].components[0].id).toBe('pivot-1');
      expect(result[0].components[0].label).toBe('Pivot Bearings');
    });

    it('includes generic components', () => {
      const bike = createBike({
        components: [
          createComponent({ id: 'chain-1', type: 'CHAIN' }),
          createComponent({ id: 'brake-1', type: 'BRAKES' }),
        ],
      });
      const result = transformToHealthData([bike]);

      expect(result[0].components).toHaveLength(2);
    });

    it('filters out duplicate FORK/SHOCK/PIVOT_BEARINGS from generic components', () => {
      const bike = createBike({
        fork: createComponent({ id: 'fork-1', type: 'FORK' }),
        components: [
          createComponent({ id: 'fork-2', type: 'FORK' }), // Should be filtered
          createComponent({ id: 'chain-1', type: 'CHAIN' }),
        ],
      });
      const result = transformToHealthData([bike]);

      expect(result[0].components).toHaveLength(2);
      expect(result[0].components.map((c) => c.id)).toContain('fork-1');
      expect(result[0].components.map((c) => c.id)).toContain('chain-1');
      expect(result[0].components.map((c) => c.id)).not.toContain('fork-2');
    });

    it('handles null/undefined components gracefully', () => {
      const bike = createBike({
        fork: null,
        shock: undefined as unknown as ComponentSummary,
        pivotBearings: null,
        components: [createComponent({ id: 'chain-1', type: 'CHAIN' })],
      });
      const result = transformToHealthData([bike]);

      expect(result[0].components).toHaveLength(1);
      expect(result[0].components[0].id).toBe('chain-1');
    });
  });

  describe('component health status', () => {
    it('sets status to "ok" for hours under 50', () => {
      const bike = createBike({
        fork: createComponent({ hoursUsed: 25 }),
      });
      const result = transformToHealthData([bike]);

      expect(result[0].components[0].status).toBe('ok');
    });

    it('sets status to "warning" for hours between 50 and 199', () => {
      const bike = createBike({
        fork: createComponent({ hoursUsed: 100 }),
      });
      const result = transformToHealthData([bike]);

      expect(result[0].components[0].status).toBe('warning');
    });

    it('sets status to "danger" for hours 200 or more', () => {
      const bike = createBike({
        fork: createComponent({ hoursUsed: 250 }),
      });
      const result = transformToHealthData([bike]);

      expect(result[0].components[0].status).toBe('danger');
    });

    it('defaults hoursUsed to 0 when null', () => {
      const bike = createBike({
        fork: createComponent({ hoursUsed: null }),
      });
      const result = transformToHealthData([bike]);

      expect(result[0].components[0].hoursUsed).toBe(0);
      expect(result[0].components[0].status).toBe('ok');
    });
  });

  describe('health counts and flags', () => {
    it('counts critical (danger) components', () => {
      const bike = createBike({
        fork: createComponent({ hoursUsed: 250 }),
        shock: createComponent({ hoursUsed: 300 }),
        components: [createComponent({ hoursUsed: 25, type: 'CHAIN' })],
      });
      const result = transformToHealthData([bike]);

      expect(result[0].criticalCount).toBe(2);
    });

    it('counts warning components', () => {
      const bike = createBike({
        fork: createComponent({ hoursUsed: 100 }),
        shock: createComponent({ hoursUsed: 150 }),
        components: [createComponent({ hoursUsed: 25, type: 'CHAIN' })],
      });
      const result = transformToHealthData([bike]);

      expect(result[0].warningCount).toBe(2);
    });

    it('sets isHealthy to true when no critical or warning', () => {
      const bike = createBike({
        fork: createComponent({ hoursUsed: 25 }),
        shock: createComponent({ hoursUsed: 30 }),
      });
      const result = transformToHealthData([bike]);

      expect(result[0].isHealthy).toBe(true);
    });

    it('sets isHealthy to false when has critical components', () => {
      const bike = createBike({
        fork: createComponent({ hoursUsed: 250 }),
      });
      const result = transformToHealthData([bike]);

      expect(result[0].isHealthy).toBe(false);
    });

    it('sets isHealthy to false when has warning components', () => {
      const bike = createBike({
        fork: createComponent({ hoursUsed: 100 }),
      });
      const result = transformToHealthData([bike]);

      expect(result[0].isHealthy).toBe(false);
    });
  });

  describe('component defaults', () => {
    it('uses "Stock" for missing brand', () => {
      const bike = createBike({
        fork: createComponent({ brand: null }),
      });
      const result = transformToHealthData([bike]);

      expect(result[0].components[0].brand).toBe('Stock');
    });

    it('uses "Stock" for missing model', () => {
      const bike = createBike({
        fork: createComponent({ model: null }),
      });
      const result = transformToHealthData([bike]);

      expect(result[0].components[0].model).toBe('Stock');
    });

    it('parses lastServiceDate from updatedAt', () => {
      const bike = createBike({
        fork: createComponent({ updatedAt: '2024-06-15T12:00:00Z' }),
      });
      const result = transformToHealthData([bike]);

      expect(result[0].components[0].lastServiceDate).toBeInstanceOf(Date);
    });

    it('sets lastServiceDate to null for invalid date', () => {
      const bike = createBike({
        fork: createComponent({ updatedAt: 'invalid-date' }),
      });
      const result = transformToHealthData([bike]);

      expect(result[0].components[0].lastServiceDate).toBeNull();
    });

    it('sets lastServiceDate to null when updatedAt is null', () => {
      const bike = createBike({
        fork: createComponent({ updatedAt: null }),
      });
      const result = transformToHealthData([bike]);

      expect(result[0].components[0].lastServiceDate).toBeNull();
    });
  });

  describe('multiple bikes', () => {
    it('transforms multiple bikes correctly', () => {
      const bikes = [
        createBike({ id: 'bike-1', nickname: 'Bike One' }),
        createBike({ id: 'bike-2', nickname: 'Bike Two' }),
        createBike({ id: 'bike-3', nickname: 'Bike Three' }),
      ];
      const result = transformToHealthData(bikes);

      expect(result).toHaveLength(3);
      expect(result.map((b) => b.name)).toEqual([
        'Bike One',
        'Bike Two',
        'Bike Three',
      ]);
    });
  });
});
