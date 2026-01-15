import { describe, it, expect } from 'vitest';
import { COMPONENT_LABELS, getComponentLabel } from './componentLabels';

describe('COMPONENT_LABELS', () => {
  it('has label for FORK', () => {
    expect(COMPONENT_LABELS.FORK).toBe('Fork');
  });

  it('has label for SHOCK', () => {
    expect(COMPONENT_LABELS.SHOCK).toBe('Rear Shock');
  });

  it('has label for BRAKES', () => {
    expect(COMPONENT_LABELS.BRAKES).toBe('Brakes');
  });

  it('has label for DRIVETRAIN', () => {
    expect(COMPONENT_LABELS.DRIVETRAIN).toBe('Drivetrain');
  });

  it('has label for TIRES', () => {
    expect(COMPONENT_LABELS.TIRES).toBe('Tires');
  });

  it('has label for CHAIN', () => {
    expect(COMPONENT_LABELS.CHAIN).toBe('Chain');
  });

  it('has label for CASSETTE', () => {
    expect(COMPONENT_LABELS.CASSETTE).toBe('Cassette');
  });

  it('has label for CHAINRING', () => {
    expect(COMPONENT_LABELS.CHAINRING).toBe('Chainring');
  });

  it('has label for WHEELS', () => {
    expect(COMPONENT_LABELS.WHEELS).toBe('Wheels');
  });

  it('has label for DROPPER', () => {
    expect(COMPONENT_LABELS.DROPPER).toBe('Dropper Post');
  });

  it('has label for PIVOT_BEARINGS', () => {
    expect(COMPONENT_LABELS.PIVOT_BEARINGS).toBe('Pivot Bearings');
  });

  it('has label for BRAKE_PAD', () => {
    expect(COMPONENT_LABELS.BRAKE_PAD).toBe('Brake Pads');
  });

  it('has label for BRAKE_ROTOR', () => {
    expect(COMPONENT_LABELS.BRAKE_ROTOR).toBe('Brake Rotors');
  });

  it('has label for HEADSET', () => {
    expect(COMPONENT_LABELS.HEADSET).toBe('Headset');
  });

  it('has label for BOTTOM_BRACKET', () => {
    expect(COMPONENT_LABELS.BOTTOM_BRACKET).toBe('Bottom Bracket');
  });
});

describe('getComponentLabel', () => {
  it('returns correct label for known component types', () => {
    expect(getComponentLabel('FORK')).toBe('Fork');
    expect(getComponentLabel('SHOCK')).toBe('Rear Shock');
    expect(getComponentLabel('PIVOT_BEARINGS')).toBe('Pivot Bearings');
  });

  it('returns the input type for unknown component types', () => {
    expect(getComponentLabel('UNKNOWN_TYPE')).toBe('UNKNOWN_TYPE');
    expect(getComponentLabel('CUSTOM_COMPONENT')).toBe('CUSTOM_COMPONENT');
  });

  it('returns empty string for empty input', () => {
    expect(getComponentLabel('')).toBe('');
  });

  it('is case-sensitive', () => {
    expect(getComponentLabel('fork')).toBe('fork');
    expect(getComponentLabel('Fork')).toBe('Fork');
    expect(getComponentLabel('FORK')).toBe('Fork');
  });
});
