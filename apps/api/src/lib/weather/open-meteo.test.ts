import { pickEndpoint } from './open-meteo';

describe('pickEndpoint', () => {
  const NOW = new Date('2026-04-15T12:00:00Z');

  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  const daysAgo = (days: number): Date =>
    new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

  it('uses forecast for a ride starting right now', () => {
    expect(pickEndpoint(NOW)).toBe('forecast');
  });

  it('uses forecast for a ride 1 day old', () => {
    expect(pickEndpoint(daysAgo(1))).toBe('forecast');
  });

  it('uses forecast for a ride just under 5 days old', () => {
    // 4 days 23 hours — still inside the archive lag window.
    expect(pickEndpoint(daysAgo(4.95))).toBe('forecast');
  });

  it('uses archive at exactly 5 days old (inclusive boundary)', () => {
    expect(pickEndpoint(daysAgo(5))).toBe('archive');
  });

  it('uses archive for a ride 10 days old', () => {
    expect(pickEndpoint(daysAgo(10))).toBe('archive');
  });

  it('uses archive for a very old ride', () => {
    expect(pickEndpoint(new Date('2020-01-01T00:00:00Z'))).toBe('archive');
  });
});
