import { describe, it, expect } from 'vitest';
import { fmtElevation, fmtElevationPair } from './format';

describe('fmtElevationPair', () => {
  it('is the bare climb when no descent is on record', () => {
    expect(fmtElevationPair(563, null)).toBe(fmtElevation(563));
    expect(fmtElevationPair(563, undefined, 'km')).toBe('563 m');
  });

  it('marks both figures once a descent exists', () => {
    expect(fmtElevationPair(563, 544)).toBe('↑ 1,847 ft ↓ 1,785 ft');
    expect(fmtElevationPair(563, 544, 'km')).toBe('↑ 563 m ↓ 544 m');
  });

  it('shows a real zero descent, since zero is a flat ride and not "unknown"', () => {
    expect(fmtElevationPair(10, 0, 'km')).toBe('↑ 10 m ↓ 0 m');
  });
});
