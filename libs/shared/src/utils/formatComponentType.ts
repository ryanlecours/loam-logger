/**
 * Canonical component-type display formatter. Historically re-implemented
 * inline across the API, web, and mobile — this is the single source of truth.
 *
 * Default output is Title Case with an optional location prefix:
 *   formatComponentType('BRAKE_PAD')                             -> 'Brake Pad'
 *   formatComponentType('BRAKE_PAD', 'FRONT')                    -> 'Front Brake Pad'
 *   formatComponentType('BRAKE_PAD', 'NONE')                     -> 'Brake Pad'
 *
 * Case override is provided for surfaces (notifications, all-caps badges)
 * that need a different visual treatment while still going through the
 * canonical enum→display transform:
 *   formatComponentType('BRAKE_PAD', null, { case: 'lower' })    -> 'brake pad'
 *   formatComponentType('BRAKE_PAD', 'FRONT', { case: 'lower' }) -> 'front brake pad'
 *
 * Location is dropped when null, undefined, or the literal 'NONE' sentinel
 * used by ComponentLocation. This mirrors the pre-consolidation behavior of
 * every prior inline transform.
 */
export function formatComponentType(
  type: string,
  location?: string | null,
  options: { case?: 'title' | 'lower' | 'upper' } = {},
): string {
  const caseMode = options.case ?? 'title';
  const parts = [location, type]
    .filter((p): p is string => Boolean(p) && p !== 'NONE')
    .map((p) => p.replace(/_/g, ' '));
  const joined = parts.join(' ');

  switch (caseMode) {
    case 'lower':
      return joined.toLowerCase();
    case 'upper':
      return joined.toUpperCase();
    case 'title':
    default:
      return joined.toLowerCase().replace(/\b\w/g, (l) => l.toUpperCase());
  }
}
