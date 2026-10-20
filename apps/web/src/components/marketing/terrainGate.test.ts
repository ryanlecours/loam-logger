import { describe, it, expect } from 'vitest';
import { shouldRenderTerrain, TERRAIN_MIN_WIDTH } from './terrainGate';

const capable = { reducedMotion: false, viewportWidth: 1440, saveData: false, webgl: true };

describe('shouldRenderTerrain', () => {
  it('renders on a capable desktop', () => {
    expect(shouldRenderTerrain(capable)).toBe(true);
  });

  it('stays off for reduced motion', () => {
    expect(shouldRenderTerrain({ ...capable, reducedMotion: true })).toBe(false);
  });

  it('stays off when the visitor asked for less data', () => {
    expect(shouldRenderTerrain({ ...capable, saveData: true })).toBe(false);
  });

  it('stays off below the phone breakpoint', () => {
    expect(shouldRenderTerrain({ ...capable, viewportWidth: TERRAIN_MIN_WIDTH - 1 })).toBe(false);
    expect(shouldRenderTerrain({ ...capable, viewportWidth: TERRAIN_MIN_WIDTH })).toBe(true);
  });

  it('stays off without WebGL', () => {
    expect(shouldRenderTerrain({ ...capable, webgl: false })).toBe(false);
  });
});
