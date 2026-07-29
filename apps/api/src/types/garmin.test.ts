import {
  isAmbiguousGarminDelivery,
  isGarminCyclingActivity,
  isPushedGarminActivity,
} from './garmin';

describe('isGarminCyclingActivity', () => {
  // Garmin spells these inconsistently across payloads, so the comparison has
  // to normalize rather than match the raw value.
  it.each([
    ['MOUNTAIN_BIKING', true],
    ['Mountain Biking', true],
    ['mountain_biking', true],
    ['GRAVEL_CYCLING', true],
    ['INDOOR_CYCLING', true],
    ['RUNNING', false],
    ['LAP_SWIMMING', false],
  ])('%s -> %s', (activityType, expected) => {
    expect(isGarminCyclingActivity(activityType)).toBe(expected);
  });

  it('is false for anything that is not a string', () => {
    expect(isGarminCyclingActivity(undefined)).toBe(false);
    expect(isGarminCyclingActivity(null)).toBe(false);
    expect(isGarminCyclingActivity(42)).toBe(false);
  });
});

describe('isPushedGarminActivity', () => {
  // The distinction the whole PUSH path turns on: data we already hold versus a
  // pointer to data we would have to go and request. Getting it wrong either
  // discards a pushed activity or issues a pull Garmin never asked for.
  it('recognizes a pushed activity carrying measurements', () => {
    expect(
      isPushedGarminActivity({
        summaryId: 'abc',
        activityType: 'MOUNTAIN_BIKING',
        durationInSeconds: 5340,
      })
    ).toBe(true);
  });

  it('treats a ping notification as not pushed', () => {
    expect(
      isPushedGarminActivity({
        userId: 'garmin-1',
        summaryId: 'abc',
        uploadTimestampInSeconds: 1706123456,
        callbackURL: 'https://apis.garmin.com/wellness-api/rest/activities?x=1',
      })
    ).toBe(false);
  });

  it('treats a backfill callback as not pushed', () => {
    expect(
      isPushedGarminActivity({
        userId: 'garmin-1',
        callbackURL: 'https://apis.garmin.com/wellness-api/rest/activities?x=1',
      })
    ).toBe(false);
  });

  // An indoor ride is a complete activity that simply has no GPS. Keying the
  // check on `samples` would send us fetching data Garmin had already sent.
  it('recognizes a pushed indoor activity with no samples', () => {
    expect(
      isPushedGarminActivity({
        summaryId: 'abc',
        activityType: 'INDOOR_CYCLING',
        durationInSeconds: 3600,
      })
    ).toBe(true);
  });

  // activityType alone is not enough: it must come with measurements, or a
  // notification that happened to name the type would be mistaken for data.
  it('is false for an activityType with no measurements', () => {
    expect(isPushedGarminActivity({ summaryId: 'abc', activityType: 'MOUNTAIN_BIKING' })).toBe(
      false
    );
  });

  /**
   * The one misclassification that reproduces the bug this whole change exists
   * to fix. A notification read as a push is never followed, so its ping is
   * scored unanswered again. Some Garmin notifications carry summary metadata,
   * and the live ping shape has not been observed, so a URL to follow always
   * wins over data that happens to be present.
   *
   * The invariant lives here rather than in the webhook's branch ordering
   * precisely so that reordering those branches cannot resurrect the bug.
   */
  it('is false when a callbackURL is present, whatever else the entry carries', () => {
    expect(
      isPushedGarminActivity({
        summaryId: 'abc',
        activityType: 'MOUNTAIN_BIKING',
        durationInSeconds: 5340,
        startTimeInSeconds: 1706123456,
        samples: [{ latitudeInDegree: 48.75 }],
        callbackURL: 'https://apis.garmin.com/wellness-api/rest/activityDetails?x=1',
      })
    ).toBe(false);
  });

  it('ignores an empty callbackURL rather than treating it as followable', () => {
    expect(
      isPushedGarminActivity({
        summaryId: 'abc',
        activityType: 'MOUNTAIN_BIKING',
        durationInSeconds: 5340,
        callbackURL: '',
      })
    ).toBe(true);
  });
});

describe('isAmbiguousGarminDelivery', () => {
  // Shaped like neither mode. Handled as a notification, but surfaced, because
  // it would mean the live ping differs from what this was written against.
  it('flags an entry carrying both a URL to follow and measurements', () => {
    expect(
      isAmbiguousGarminDelivery({
        summaryId: 'abc',
        activityType: 'MOUNTAIN_BIKING',
        durationInSeconds: 5340,
        callbackURL: 'https://apis.garmin.com/wellness-api/rest/activityDetails?x=1',
      })
    ).toBe(true);
  });

  it('does not flag an ordinary notification', () => {
    expect(
      isAmbiguousGarminDelivery({
        userId: 'garmin-1',
        summaryId: 'abc',
        uploadTimestampInSeconds: 1706123456,
        callbackURL: 'https://apis.garmin.com/wellness-api/rest/activities?x=1',
      })
    ).toBe(false);
  });

  it('does not flag an ordinary push', () => {
    expect(
      isAmbiguousGarminDelivery({
        summaryId: 'abc',
        activityType: 'MOUNTAIN_BIKING',
        durationInSeconds: 5340,
      })
    ).toBe(false);
  });
});
