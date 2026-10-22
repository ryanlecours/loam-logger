import { describe, it, expect } from 'vitest';
import { toDistanceInput, toElevationInput, toDescentInput } from './rideInputs';

// The edit modal sends a measured field only when its input differs from
// what these helpers produced on open, so their rounding is a contract.
describe('ride edit input helpers', () => {
  it('rounds distance to a tenth in the rider unit', () => {
    expect(toDistanceInput(8368.4, 'mi')).toBe(5.2);
    expect(toDistanceInput(8368.4, 'km')).toBe(8.4);
  });

  it('rounds elevation to a whole unit', () => {
    expect(toElevationInput(563.1, 'mi')).toBe(1847);
    expect(toElevationInput(563.1, 'km')).toBe(563);
  });

  it('keeps a missing descent blank, and a zero descent zero', () => {
    expect(toDescentInput(null, 'mi')).toBe('');
    expect(toDescentInput(undefined, 'km')).toBe('');
    expect(toDescentInput(0, 'mi')).toBe(0);
    expect(toDescentInput(544.1, 'mi')).toBe(1785);
  });

  it('is stable: the same stored value compares equal on a second call', () => {
    expect(toDistanceInput(8368.4, 'mi')).toBe(toDistanceInput(8368.4, 'mi'));
    expect(toDescentInput(544.1, 'km')).toBe(toDescentInput(544.1, 'km'));
  });
});
