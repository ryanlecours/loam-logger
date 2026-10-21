import { elevationLossFromProvider, whoopElevationLoss } from './elevation-loss';

describe('elevationLossFromProvider', () => {
  it('passes a reported figure through', () => {
    expect(elevationLossFromProvider(371.5)).toBe(371.5);
    expect(elevationLossFromProvider(0)).toBe(0);
  });

  it('is null when the provider sent nothing usable', () => {
    expect(elevationLossFromProvider(undefined)).toBeNull();
    expect(elevationLossFromProvider(null)).toBeNull();
    expect(elevationLossFromProvider(NaN)).toBeNull();
    expect(elevationLossFromProvider('371')).toBeNull();
  });

  it('clamps a negative figure to zero rather than storing it', () => {
    expect(elevationLossFromProvider(-4)).toBe(0);
  });
});

describe('whoopElevationLoss', () => {
  it('derives loss as gain minus net change', () => {
    expect(whoopElevationLoss({ altitude_gain_meter: 500, altitude_change_meter: 100 })).toBe(400);
    // Ended lower than it started: more descent than climb.
    expect(whoopElevationLoss({ altitude_gain_meter: 300, altitude_change_meter: -200 })).toBe(500);
  });

  it('is null without both inputs', () => {
    expect(whoopElevationLoss(undefined)).toBeNull();
    expect(whoopElevationLoss({ altitude_gain_meter: 300 })).toBeNull();
    expect(whoopElevationLoss({ altitude_change_meter: 100 })).toBeNull();
  });

  it('treats an impossible negative result as unknown, not zero', () => {
    expect(whoopElevationLoss({ altitude_gain_meter: 50, altitude_change_meter: 80 })).toBeNull();
  });
});
