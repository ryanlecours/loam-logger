import {
  formatGarminSource,
  humanizeGarminDevice,
  hasGarminData,
  GARMIN_SOURCE_FALLBACK,
  GARMIN_CHART_ATTRIBUTION,
  GARMIN_INSIGHT_ATTRIBUTION,
  GARMIN_CONNECT_APP_NAME,
} from './attribution';

describe('formatGarminSource', () => {
  it('prefixes the humanized device model with the brand', () => {
    expect(formatGarminSource('edge_840')).toBe('Garmin Edge 840');
    expect(formatGarminSource('edge_1030_plus')).toBe('Garmin Edge 1030 Plus');
  });

  // The guidelines permit exactly this fallback: "If the device model is not
  // provided or unknown via the API, list Garmin as the data source." It is
  // what lets us ship without backfilling historical rides.
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['whitespace only', '   '],
  ])('falls back to plain "Garmin" for %s', (_label, input) => {
    expect(formatGarminSource(input)).toBe(GARMIN_SOURCE_FALLBACK);
  });

  it('does not double-prefix when Garmin already reports the brand', () => {
    expect(formatGarminSource('garmin_edge_840')).toBe('Garmin Edge 840');
    expect(formatGarminSource('Garmin Edge 840')).toBe('Garmin Edge 840');
  });

  it('never returns an empty or brandless label', () => {
    for (const input of ['', '  ', '_', '-', '__--__', null, undefined]) {
      const result = formatGarminSource(input);
      expect(result.length).toBeGreaterThan(0);
      expect(result.startsWith('Garmin')).toBe(true);
    }
  });
});

describe('humanizeGarminDevice', () => {
  it('converts snake_case tokens to spaced title case', () => {
    expect(humanizeGarminDevice('edge_840')).toBe('Edge 840');
    expect(humanizeGarminDevice('forerunner_965')).toBe('Forerunner 965');
  });

  it('leaves digit-bearing tokens intact rather than guessing a split', () => {
    // "fenix7" must not become "Fenix 7" — inventing a model name Garmin does
    // not use is a misrepresentation, which the guidelines treat as a breach.
    expect(humanizeGarminDevice('fenix7')).toBe('Fenix7');
  });

  it('preserves already-capitalized product names', () => {
    expect(humanizeGarminDevice('GPSMAP_66i')).toBe('GPSMAP 66i');
    expect(humanizeGarminDevice('MARQ')).toBe('MARQ');
  });

  it('collapses repeated and mixed separators', () => {
    expect(humanizeGarminDevice('edge__1030--plus')).toBe('Edge 1030 Plus');
  });
});

describe('hasGarminData', () => {
  it('is true whenever a Garmin activity id is present', () => {
    expect(hasGarminData({ garminActivityId: 'summary-1' })).toBe(true);
  });

  // Regression guard for the real bug this replaced: getRideSource ranked
  // Strava above Garmin, so a ride matched across both providers rendered as
  // Strava-only and suppressed Garmin attribution entirely.
  it('is true for a ride matched across providers, not just Garmin-only rides', () => {
    expect(
      hasGarminData({ garminActivityId: 'summary-1', stravaActivityId: '123' } as {
        garminActivityId?: string | null;
      })
    ).toBe(true);
  });

  // The inverse is a compliance requirement too: the guidelines forbid Garmin
  // branding "in instances where Garmin device-sourced data is not present".
  it('is false for non-Garmin rides', () => {
    expect(hasGarminData({ garminActivityId: null })).toBe(false);
    expect(hasGarminData({})).toBe(false);
  });
});

describe('sanctioned attribution strings', () => {
  // These are quoted verbatim from the guidelines' "Acceptable" sample
  // messaging. Rewording them is what turns an approved submission into a
  // noncompliant one, so pin them exactly.
  it('matches the guidelines verbatim', () => {
    expect(GARMIN_CHART_ATTRIBUTION).toBe(
      'This chart was created using data provided by Garmin devices.'
    );
    expect(GARMIN_INSIGHT_ATTRIBUTION).toBe(
      'Insights derived in part from Garmin device-sourced data.'
    );
  });

  it('keeps the Garmin Connect app name unabbreviated and trademarked', () => {
    expect(GARMIN_CONNECT_APP_NAME).toBe('Garmin Connect™');
  });
});
