import {
  MAX_RECORDED_TRACK_POINTS,
  normalizeRecordedTrack,
  type RecordedTrackInput,
} from './recorded-track';

/** A short, valid track climbing east out of Bellingham. */
function track(points: number): RecordedTrackInput {
  return {
    time: Array.from({ length: points }, (_, i) => i * 2),
    latlng: Array.from({ length: points }, (_, i) => [48.7519 + i * 1e-4, -122.4787]),
    // Sawtooth rather than a monotonic climb: a 20,000-point fixture would
    // otherwise run off the top of the plausible-altitude range.
    altitude: Array.from({ length: points }, (_, i) => 100 + (i % 500)),
    moving: Array.from({ length: points }, () => true),
  };
}

describe('normalizeRecordedTrack', () => {
  it('normalizes a well-formed track into parallel arrays', () => {
    const result = normalizeRecordedTrack(track(50));
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.pointCount).toBe(50);
    expect(result.data.time).toHaveLength(50);
    expect(result.data.latlng).toHaveLength(50);
    expect(result.data.altitude).toHaveLength(50);
    expect(result.data.moving).toHaveLength(50);
  });

  it('carries the moving flag through, so lift detection sees the stops', () => {
    const input = track(10);
    input.moving[4] = false;
    input.moving[5] = false;
    const result = normalizeRecordedTrack(input);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.data.moving).toEqual([true, true, true, true, false, false, true, true, true, true]);
  });

  // RideSegment stores integer indexes into these arrays, so a ragged track
  // would have lift detection reading one sample's altitude at another
  // sample's coordinate.
  it('rejects ragged arrays', () => {
    const input = track(10);
    input.altitude.pop();
    const result = normalizeRecordedTrack(input);
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') return;
    expect(result.reason).toContain('ragged');
  });

  it('rejects a track too short to describe a route', () => {
    expect(normalizeRecordedTrack(track(1)).status).toBe('invalid');
  });

  it('rejects missing arrays rather than throwing on them', () => {
    const result = normalizeRecordedTrack({ time: [0, 1] } as unknown as RecordedTrackInput);
    expect(result.status).toBe('invalid');
  });

  it('rejects time running backwards', () => {
    const input = track(10);
    input.time[5] = 2;
    const result = normalizeRecordedTrack(input);
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') return;
    expect(result.reason).toContain('decreases');
  });

  it('accepts time standing still, which a paused sample legitimately does', () => {
    const input = track(10);
    input.time[5] = input.time[4];
    expect(normalizeRecordedTrack(input).status).toBe('ok');
  });

  it.each([
    ['latitude', 91, -122],
    ['longitude', 48, 181],
  ])('rejects an out-of-range %s', (_label, lat, lng) => {
    const input = track(10);
    input.latlng[3] = [lat, lng];
    expect(normalizeRecordedTrack(input).status).toBe('invalid');
  });

  it.each([-501, 9001, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an implausible altitude (%s)',
    (altitude) => {
      const input = track(10);
      input.altitude[3] = altitude;
      expect(normalizeRecordedTrack(input).status).toBe('invalid');
    }
  );

  // Exactly (0, 0) is the "no fix yet" sentinel some location stacks emit. One
  // slipped sentinel should cost the rider that point, not their whole route.
  it('drops the (0,0) sentinel without dropping the track', () => {
    const input = track(10);
    input.latlng[3] = [0, 0];
    const result = normalizeRecordedTrack(input);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.pointCount).toBe(9);
    expect(result.data.latlng.some(([lat, lng]) => lat === 0 && lng === 0)).toBe(false);
    // And the arrays stay aligned after the drop.
    expect(result.data.time).toHaveLength(9);
    expect(result.data.altitude).toHaveLength(9);
    expect(result.data.moving).toHaveLength(9);
  });

  // Thinning beats truncating: a truncated track loses the back half of the
  // ride, and lift detection would analyze a route that stops mid-mountain.
  it('thins an oversized track instead of truncating it', () => {
    const input = track(MAX_RECORDED_TRACK_POINTS * 2);
    const result = normalizeRecordedTrack(input);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.pointCount).toBe(MAX_RECORDED_TRACK_POINTS);
    expect(result.data.time[0]).toBe(0);
    // The last sample of the ride survives, so the route still reaches the end.
    expect(result.data.time.at(-1)).toBe(input.time.at(-1));
    expect(result.data.latlng.at(-1)).toEqual(input.latlng.at(-1));
  });

  it('leaves a track at exactly the ceiling untouched', () => {
    const result = normalizeRecordedTrack(track(MAX_RECORDED_TRACK_POINTS));
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.pointCount).toBe(MAX_RECORDED_TRACK_POINTS);
  });
});
