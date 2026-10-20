import { useMemo } from 'react';
import { buildRidgeField, RIDGE_VIEWBOX_HEIGHT, RIDGE_VIEWBOX_WIDTH } from './ridge';

type Props = {
  count?: number;
  className?: string;
};

/**
 * The hero's ridge: a few faint contour lines in fog over the trail bed,
 * closing the photo into the page. Plain SVG, no script, no motion.
 */
export default function RidgeLines({ count = 7, className = 'lp-hero__ridge' }: Props) {
  const field = useMemo(() => buildRidgeField(count), [count]);

  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox={`0 0 ${RIDGE_VIEWBOX_WIDTH} ${RIDGE_VIEWBOX_HEIGHT}`}
      preserveAspectRatio="none"
      data-testid="hero-ridge"
    >
      <path d={field.groundPath} fill="var(--obsidian)" opacity="0.92" />
      {field.lines.map((line, index) => (
        <polyline
          key={index}
          points={line.points}
          fill="none"
          stroke="#b7c0ba"
          strokeOpacity={line.alpha}
          strokeWidth="1"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
