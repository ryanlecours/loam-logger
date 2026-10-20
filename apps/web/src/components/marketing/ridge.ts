/**
 * Static ridge lines for the landing hero.
 *
 * A stack of layered polylines that read as a wireframe terrain: far ridges
 * sit high and faint, near ridges sit low, bright and tall. This is the
 * reduced-motion and no-WebGL rendering of the hero terrain, and it is what
 * the three.js scene fades in over, so both share the same silhouette math.
 */

export type RidgeLine = {
  points: string;
  alpha: number;
};

export type RidgeField = {
  lines: RidgeLine[];
  groundPath: string;
};

export const RIDGE_VIEWBOX_WIDTH = 1440;
export const RIDGE_VIEWBOX_HEIGHT = 420;

export function ridgeHeight(u: number, t: number, line: number, height = RIDGE_VIEWBOX_HEIGHT): number {
  const base = 60 + Math.pow(t, 1.7) * 300;
  const amp = 16 + t * 72;
  const y =
    base -
    amp *
      (0.55 * Math.sin(u * 6.1 + line * 0.7) +
        0.3 * Math.sin(u * 13.7 + line * 1.9) +
        0.15 * Math.sin(u * 29 + line * 3.1)) -
    (1 - t) * 24 * Math.sin(u * 3.2 + 1.3);
  // The nearest ridge can dip a pixel or two under the viewbox in a trough;
  // hold it at the floor rather than let the ground path open up.
  return Math.min(Math.max(y, 8), height - 4);
}

export function buildRidgeField(
  count = 14,
  width = RIDGE_VIEWBOX_WIDTH,
  height = RIDGE_VIEWBOX_HEIGHT,
  step = 20,
): RidgeField {
  const lineCount = Math.max(2, Math.min(28, Math.round(count)));
  const lines: RidgeLine[] = [];
  let nearest = '';

  for (let i = 0; i < lineCount; i++) {
    const t = i / (lineCount - 1);
    const points: string[] = [];
    for (let x = 0; x <= width; x += step) {
      const y = ridgeHeight(x / width, t, i, height);
      points.push(`${x},${y.toFixed(1)}`);
    }
    const joined = points.join(' ');
    lines.push({ points: joined, alpha: Number((0.1 + t * 0.45).toFixed(2)) });
    if (i === lineCount - 1) nearest = joined;
  }

  const groundPath = `M0,${height} L${nearest.split(' ').join(' L')} L${width},${height} Z`;
  return { lines, groundPath };
}
