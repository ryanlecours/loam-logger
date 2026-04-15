import { wmoToCondition, applyWindyOverride } from './normalize';

describe('wmoToCondition', () => {
  it('maps clear sky to SUNNY', () => {
    expect(wmoToCondition(0)).toBe('SUNNY');
  });

  it('maps partly cloudy codes to CLOUDY', () => {
    expect(wmoToCondition(1)).toBe('CLOUDY');
    expect(wmoToCondition(2)).toBe('CLOUDY');
    expect(wmoToCondition(3)).toBe('CLOUDY');
  });

  it('maps fog codes to FOGGY', () => {
    expect(wmoToCondition(45)).toBe('FOGGY');
    expect(wmoToCondition(48)).toBe('FOGGY');
  });

  it('maps drizzle, rain, showers, thunderstorms to RAINY', () => {
    expect(wmoToCondition(51)).toBe('RAINY');
    expect(wmoToCondition(63)).toBe('RAINY');
    expect(wmoToCondition(82)).toBe('RAINY');
    expect(wmoToCondition(95)).toBe('RAINY');
    expect(wmoToCondition(99)).toBe('RAINY');
  });

  it('maps snow codes to SNOWY', () => {
    expect(wmoToCondition(71)).toBe('SNOWY');
    expect(wmoToCondition(77)).toBe('SNOWY');
    expect(wmoToCondition(85)).toBe('SNOWY');
    expect(wmoToCondition(86)).toBe('SNOWY');
  });

  it('maps unknown codes to UNKNOWN', () => {
    expect(wmoToCondition(999)).toBe('UNKNOWN');
    expect(wmoToCondition(-1)).toBe('UNKNOWN');
    expect(wmoToCondition(NaN)).toBe('UNKNOWN');
  });
});

describe('applyWindyOverride', () => {
  it('promotes SUNNY to WINDY at high wind speeds', () => {
    expect(applyWindyOverride('SUNNY' as any, 45)).toBe('WINDY');
  });

  it('promotes CLOUDY to WINDY at high wind speeds', () => {
    expect(applyWindyOverride('CLOUDY' as any, 50)).toBe('WINDY');
  });

  it('does not override RAINY or SNOWY', () => {
    expect(applyWindyOverride('RAINY' as any, 60)).toBe('RAINY');
    expect(applyWindyOverride('SNOWY' as any, 60)).toBe('SNOWY');
  });

  it('does not promote at low winds', () => {
    expect(applyWindyOverride('SUNNY' as any, 10)).toBe('SUNNY');
  });
});
