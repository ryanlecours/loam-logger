/**
 * Decides whether the landing hero loads its three.js terrain.
 *
 * The scene is decoration. It never loads where it would cost more than it
 * gives: reduced-motion users, phones, browsers without WebGL, or anyone who
 * asked for less data. In every one of those cases the static SVG ridge is
 * the hero, and nothing on the page depends on the canvas.
 */

export type TerrainEnvironment = {
  reducedMotion: boolean;
  viewportWidth: number;
  saveData: boolean;
  webgl: boolean;
};

export const TERRAIN_MIN_WIDTH = 768;

export function shouldRenderTerrain(env: TerrainEnvironment): boolean {
  if (env.reducedMotion) return false;
  if (env.saveData) return false;
  if (env.viewportWidth < TERRAIN_MIN_WIDTH) return false;
  return env.webgl;
}

type NavigatorWithConnection = Navigator & {
  connection?: { saveData?: boolean };
};

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export function detectTerrainEnvironment(): TerrainEnvironment {
  if (typeof window === 'undefined') {
    return { reducedMotion: true, viewportWidth: 0, saveData: false, webgl: false };
  }

  const reducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const saveData = Boolean((navigator as NavigatorWithConnection).connection?.saveData);
  const viewportWidth = window.innerWidth;

  // Probe WebGL last and only when the cheaper checks already pass, so a
  // reduced-motion visitor never pays for a context just to throw it away.
  const cheapGate = shouldRenderTerrain({ reducedMotion, viewportWidth, saveData, webgl: true });
  const webgl = cheapGate ? hasWebGL() : false;

  return { reducedMotion, viewportWidth, saveData, webgl };
}
