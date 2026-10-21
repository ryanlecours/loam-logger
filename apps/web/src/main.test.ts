import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * main.tsx has side effects on import (Sentry, PostHog, createRoot), so it is
 * checked as source. The guard injected by the landing prerender hides #root on
 * every route except "/" until RevealAfterMount runs; if it ever moved out of
 * the root tree, deep links like /dashboard would stay invisible.
 */
describe('main.tsx', () => {
  const source = readFileSync(path.resolve(__dirname, 'main.tsx'), 'utf8');

  it('mounts RevealAfterMount in the root tree beside App', () => {
    expect(source).toMatch(/import RevealAfterMount from '\.\/components\/RevealAfterMount'/);
    expect(source).toMatch(/<App \/>\s*<RevealAfterMount \/>/);
  });
});
