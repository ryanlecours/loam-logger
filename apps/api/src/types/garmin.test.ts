import {
  isAmbiguousGarminDelivery,
  isGarminCyclingActivity,
  isPushedGarminActivity,
  pickGarminActivityFields,
} from './garmin';
import { extractGarminStartCoords } from '../lib/garmin-coords';

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

describe('pickGarminActivityFields', () => {
  /**
   * A pushed entry arrives in an unauthenticated body and is then persisted
   * into BullMQ job data, which lives in Redis in plaintext. Garmin puts the
   * rider's access token in that body: a credential this integration never
   * uses, keeps out of logs via lib/logger.ts redaction, and encrypts at rest
   * everywhere it does store one. Queueing the raw entry undoes all three.
   */
  it('strips the access token Garmin sends in the body', () => {
    const picked = pickGarminActivityFields({
      summaryId: 'abc',
      activityType: 'MOUNTAIN_BIKING',
      durationInSeconds: 5340,
      userAccessToken: 'a-real-garmin-token',
    });

    expect(picked).not.toHaveProperty('userAccessToken');
    expect(picked.summaryId).toBe('abc');
  });

  // An allowlist rather than a denylist, because the entry type carries an
  // index signature: what we want is knowable and small, what someone might
  // send is not.
  it('drops anything not on the allowlist', () => {
    const picked = pickGarminActivityFields({
      summaryId: 'abc',
      activityType: 'MOUNTAIN_BIKING',
      durationInSeconds: 5340,
      userId: 'garmin-1',
      callbackURL: 'https://apis.garmin.com/x',
      somethingNobodyAskedFor: 'x'.repeat(1000),
      __proto__: { polluted: true },
    } as never);

    expect(Object.keys(picked).sort()).toEqual(
      ['activityType', 'durationInSeconds', 'summaryId'].sort()
    );
  });

  it('keeps every stat the upsert reads, and the track', () => {
    const full = {
      summaryId: 'abc',
      activityId: 12345,
      activityType: 'MOUNTAIN_BIKING',
      activityName: 'Galbraith',
      startTimeInSeconds: 1706123456,
      startTimeOffsetInSeconds: -28800,
      durationInSeconds: 5340,
      distanceInMeters: 8368,
      elevationGainInMeters: 369,
      totalElevationGainInMeters: 369,
      averageHeartRateInBeatsPerMinute: 104,
      maxHeartRateInBeatsPerMinute: 168,
      locationName: 'Bellingham',
      deviceName: 'fenix8',
      samples: [{ latitudeInDegree: 48.75 }],
    };

    expect(pickGarminActivityFields(full)).toEqual(full);
  });

  /**
   * The projection's real risk: dropping a coordinate spelling would silently
   * cost a ride its start point, and with it weather enrichment. Garmin has
   * shipped four spellings per axis, so this asserts against the extractor
   * itself rather than trusting the allowlist to stay in step with it.
   */
  it.each([
    ['startingLatitudeInDegrees', 'startingLongitudeInDegrees'],
    ['startingLatitudeInDegree', 'startingLongitudeInDegree'],
    ['startLatitudeInDegrees', 'startLongitudeInDegrees'],
    ['beginLatitude', 'beginLongitude'],
  ])('survives coordinates spelled %s / %s', (latKey, lngKey) => {
    const picked = pickGarminActivityFields({
      summaryId: 'abc',
      activityType: 'MOUNTAIN_BIKING',
      durationInSeconds: 5340,
      [latKey]: 48.75,
      [lngKey]: -122.48,
    });

    expect(extractGarminStartCoords(picked)).toEqual({ lat: 48.75, lng: -122.48 });
  });

  it('omits absent fields rather than writing undefined into the job', () => {
    const picked = pickGarminActivityFields({
      summaryId: 'abc',
      activityType: 'MOUNTAIN_BIKING',
      durationInSeconds: 5340,
    });

    expect('deviceName' in picked).toBe(false);
    expect('samples' in picked).toBe(false);
  });
});
