import { garminRideKey } from './garmin-ride-key';

describe('garminRideKey', () => {
  it('passes a summary id through untouched', () => {
    expect(garminRideKey('9876543210')).toBe('9876543210');
  });

  it('strips the details suffix so both deliveries share one key', () => {
    expect(garminRideKey('9876543210-detail')).toBe('9876543210');
  });

  it('is idempotent, so it is safe on every read and write', () => {
    expect(garminRideKey(garminRideKey('9876543210-detail'))).toBe('9876543210');
  });

  it('keeps a hyphen that is part of the id itself', () => {
    // The dangerous failure is the opposite of a duplicate: a rule that kept
    // only the leading segment would collapse these two distinct activities
    // onto one row and silently lose a ride.
    expect(garminRideKey('activity-123')).toBe('activity-123');
    expect(garminRideKey('activity-456')).toBe('activity-456');
    expect(garminRideKey('activity-123')).not.toBe(garminRideKey('activity-456'));
  });

  it('only strips the suffix at the end', () => {
    expect(garminRideKey('9876543210-detail-2')).toBe('9876543210-detail-2');
    expect(garminRideKey('detail-9876543210')).toBe('detail-9876543210');
  });
});
