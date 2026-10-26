import { OSM_COPYRIGHT_URL } from '../../lib/rideLift';

/**
 * ODbL credit for anything derived from the OpenStreetMap lift snapshot: a
 * lift's name, or a climb with a lift's share removed. Shown on the same
 * screen as the figure (docs/lift-geometry-local.md).
 */
export default function OsmCredit({ className = '' }: { className?: string }) {
  return (
    <p className={`text-xs text-muted ${className}`.trim()}>
      Lift data{' '}
      <a
        href={OSM_COPYRIGHT_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-primary"
      >
        © OpenStreetMap contributors
      </a>
    </p>
  );
}
