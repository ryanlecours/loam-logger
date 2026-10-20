import { describe, it, expect } from 'vitest';
import { buildRidgeField, ridgeHeight, RIDGE_VIEWBOX_HEIGHT, RIDGE_VIEWBOX_WIDTH } from './ridge';

describe('buildRidgeField', () => {
  it('builds the requested number of lines, far to near', () => {
    const field = buildRidgeField(6);
    expect(field.lines).toHaveLength(6);
    // Far lines are faint, near lines are bright.
    expect(field.lines[0].alpha).toBeLessThan(field.lines[5].alpha);
    expect(field.lines[0].alpha).toBeGreaterThan(0);
    expect(field.lines[5].alpha).toBeLessThanOrEqual(0.55);
  });

  it('clamps the line count to something drawable', () => {
    expect(buildRidgeField(1).lines).toHaveLength(2);
    expect(buildRidgeField(500).lines).toHaveLength(28);
  });

  it('spans the full viewbox width on every line', () => {
    const field = buildRidgeField(4);
    for (const line of field.lines) {
      const points = line.points.split(' ');
      expect(points[0].startsWith('0,')).toBe(true);
      expect(points[points.length - 1].startsWith(`${RIDGE_VIEWBOX_WIDTH},`)).toBe(true);
    }
  });

  it('closes the ground path along the nearest ridge', () => {
    const field = buildRidgeField(4);
    const nearest = field.lines[3].points;
    expect(field.groundPath.startsWith(`M0,${RIDGE_VIEWBOX_HEIGHT} L${nearest.split(' ')[0]}`)).toBe(true);
    expect(field.groundPath.endsWith(`L${RIDGE_VIEWBOX_WIDTH},${RIDGE_VIEWBOX_HEIGHT} Z`)).toBe(true);
  });

  it('keeps every ridge inside the viewbox', () => {
    for (let line = 0; line < 14; line++) {
      const t = line / 13;
      for (let u = 0; u <= 1; u += 0.01) {
        const y = ridgeHeight(u, t, line);
        expect(y).toBeGreaterThan(0);
        expect(y).toBeLessThan(RIDGE_VIEWBOX_HEIGHT);
      }
    }
  });
});
