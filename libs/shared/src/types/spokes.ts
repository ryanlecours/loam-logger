/**
 * The wire shape of a bike-search result from `GET /api/spokes/search`.
 *
 * One declaration, shared, because there used to be four: the API's own, plus
 * a hand-rolled copy in each of three web components. Nothing linked them, so
 * when the API started returning thumbnails and a nullable year, TypeScript
 * had no way to notice that the frontends still described the old payload.
 * A duplicated interface of a remote response is not a type, it is a guess
 * that happens to compile.
 */
export interface SpokesSearchResult {
  id: string;
  maker: string;
  model: string;
  /**
   * Null when 99spokes sends a listing with no model year. Search sorts these
   * last rather than to the top.
   *
   * Callers that feed `addBike` must guard: `AddBikeInput.year` is a required
   * `Int!`, so a bike with no year cannot be created at all.
   */
  year: number | null;
  family: string;
  category: string;
  subcategory: string | null;
  /** Catalog product shot. Null when 99spokes has no image for the build. */
  thumbnailUrl: string | null;
  /** 'complete' | 'frameset' when 99spokes reports it. */
  buildKind: string | null;
  /**
   * Frame-only listing. Absent from the response entirely when the caller
   * passed `excludeFramesets`.
   */
  isFrameset: boolean;
}

/**
 * The rider-facing name for a search result: "2026 Evil Offering X0".
 *
 * Exists because `${bike.year} ${bike.maker} ${bike.model}` prints the word
 * "null" once a listing has no model year, and that string reached the search
 * box, an aria-label, and a saved form field before anyone noticed. JSX
 * interpolation renders null as nothing, so only the template-literal call
 * sites were affected, which is exactly the kind of inconsistency a shared
 * helper should absorb.
 */
export function formatSpokesBikeLabel(
  bike: Pick<SpokesSearchResult, 'year' | 'maker' | 'model'>,
): string {
  return [bike.year, bike.maker, bike.model].filter(Boolean).join(' ');
}

/**
 * Can this listing be turned into a bike?
 *
 * `AddBikeInput.year` is a required `Int!`, so a result with no model year
 * cannot create one. Flows that build a bike straight from a search row have
 * to check before they submit; flows with a year field of their own can let
 * the rider fill it in instead.
 *
 * A type predicate rather than a plain boolean, so the year is narrowed to a
 * number for the submit that follows.
 */
export function canCreateBikeFrom<T extends Pick<SpokesSearchResult, 'year'>>(
  bike: T,
): bike is T & { year: number } {
  return typeof bike.year === 'number';
}
