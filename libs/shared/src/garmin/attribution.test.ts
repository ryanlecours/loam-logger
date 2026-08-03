import {
  formatGarminSource,
  humanizeGarminDevice,
  hasGarminData,
  isGarminDevice,
  garminSourceDevice,
  stravaRecordingDevice,
  normalizeGarminDeviceName,
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

  // Garmin sends deviceName "unknown" on manually-edited activities. It must
  // read as "no device" (plain "Garmin"), never as a model named "Unknown" —
  // rendering "Garmin Unknown" is the bug this guards against.
  it.each([['unknown'], ['Unknown'], ['UNKNOWN'], ['unknown_device'], ['none']])(
    'treats the placeholder %s as no device',
    (input) => {
      expect(formatGarminSource(input)).toBe(GARMIN_SOURCE_FALLBACK);
    }
  );

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

describe('normalizeGarminDeviceName', () => {
  it('returns a real model unchanged (trimmed)', () => {
    expect(normalizeGarminDeviceName('edge_840')).toBe('edge_840');
    expect(normalizeGarminDeviceName('  fenix7  ')).toBe('fenix7');
  });

  it('returns undefined for blanks and non-strings', () => {
    for (const input of [undefined, null, '', '   ', 42, {}]) {
      expect(normalizeGarminDeviceName(input)).toBeUndefined();
    }
  });

  // The reason this exists: dropping the sentinel at ingestion is what stops a
  // manual edit from overwriting a real model already stored on the ride.
  it('returns undefined for Garmin placeholder sentinels, case-insensitively', () => {
    for (const input of ['unknown', 'Unknown', 'UNKNOWN', 'unknown_device', 'null', 'none']) {
      expect(normalizeGarminDeviceName(input)).toBeUndefined();
    }
  });
});

describe('isGarminDevice', () => {
  // Strava reports the recorder as its full name, so a leading "Garmin" marks a
  // ride that was recorded on Garmin hardware and reached us via Strava.
  it('recognizes a Strava-reported Garmin device', () => {
    expect(isGarminDevice('Garmin Edge 840')).toBe(true);
    expect(isGarminDevice('garmin edge 1030')).toBe(true);
  });

  it('is false for non-Garmin devices and for blanks/sentinels', () => {
    for (const input of ['Wahoo ELEMNT BOLT', 'iPhone', 'unknown', '', null, undefined]) {
      expect(isGarminDevice(input)).toBe(false);
    }
  });

  // Must not fire on a substring: a device merely containing "garmin" is not the
  // same as one Strava names as a Garmin unit.
  it('requires "Garmin" at the start, not merely present', () => {
    expect(isGarminDevice('NotGarmin 3')).toBe(false);
  });
});

describe('garminSourceDevice', () => {
  it('uses the native Garmin model for a Garmin ride', () => {
    expect(
      garminSourceDevice({ garminActivityId: 's1', garminDeviceName: 'edge_840' })
    ).toBe('edge_840');
  });

  it('falls back to undefined (plain "Garmin") for a Garmin ride with no model', () => {
    expect(
      garminSourceDevice({ garminActivityId: 's1', garminDeviceName: null })
    ).toBeUndefined();
  });

  it('uses the Strava-reported model for a Garmin-recorded Strava ride', () => {
    expect(
      garminSourceDevice({ stravaDeviceName: 'Garmin Edge 840' })
    ).toBe('Garmin Edge 840');
    expect(formatGarminSource(garminSourceDevice({ stravaDeviceName: 'Garmin Edge 840' }))).toBe(
      'Garmin Edge 840'
    );
  });

  it('is undefined for a non-Garmin Strava ride', () => {
    expect(garminSourceDevice({ stravaDeviceName: 'Wahoo ELEMNT' })).toBeUndefined();
  });
});

describe('stravaRecordingDevice', () => {
  it('returns a non-Garmin device Strava reported, as-is', () => {
    expect(stravaRecordingDevice({ stravaDeviceName: 'Wahoo ELEMNT BOLT' })).toBe('Wahoo ELEMNT BOLT');
    expect(stravaRecordingDevice({ stravaDeviceName: '  iPhone 14  ' })).toBe('iPhone 14');
  });

  // Garmin devices are surfaced as their own attribution badge, not here, so
  // this must not double them up.
  it('is undefined for a Garmin device', () => {
    expect(stravaRecordingDevice({ stravaDeviceName: 'Garmin Edge 840' })).toBeUndefined();
  });

  it('is undefined when Strava reported no device', () => {
    for (const input of [null, undefined, '', '   ']) {
      expect(stravaRecordingDevice({ stravaDeviceName: input })).toBeUndefined();
    }
  });
});

describe('hasGarminData', () => {
  it('is true whenever a Garmin activity id is present', () => {
    expect(hasGarminData({ garminActivityId: 'summary-1' })).toBe(true);
  });

  // Garmin's cross-provider requirement: a Strava-imported ride recorded on a
  // Garmin device carries Garmin data and must be attributed.
  it('is true for a Strava ride recorded on a Garmin device', () => {
    expect(
      hasGarminData({ stravaActivityId: '123', stravaDeviceName: 'Garmin Edge 840' })
    ).toBe(true);
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
    // Strava-only rides on non-Garmin hardware must stay unattributed.
    expect(hasGarminData({ stravaActivityId: '123', stravaDeviceName: 'Wahoo ELEMNT' })).toBe(
      false
    );
    expect(hasGarminData({ stravaActivityId: '123', stravaDeviceName: null })).toBe(false);
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
