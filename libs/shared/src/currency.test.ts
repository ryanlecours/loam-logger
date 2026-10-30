import { currencyMinorDigits, isSupportedCurrency, majorToMinor, minorToMajor } from './currency';

describe('majorToMinor', () => {
  it('reads plain amounts with a dot or a comma decimal separator', () => {
    expect(majorToMinor('12.34', 'USD')).toBe(1234);
    expect(majorToMinor('12,34', 'EUR')).toBe(1234);
    expect(majorToMinor('12', 'USD')).toBe(1200);
    expect(majorToMinor('12.5', 'USD')).toBe(1250);
    expect(majorToMinor('0.05', 'USD')).toBe(5);
    expect(majorToMinor(12.34, 'USD')).toBe(1234);
    expect(majorToMinor(' 85 ', 'USD')).toBe(8500);
  });

  it('reads thousands groups only when a later separator makes them unambiguous', () => {
    expect(majorToMinor('1 200', 'EUR')).toBe(120000);
    expect(majorToMinor('1,200.50', 'USD')).toBe(120050);
    expect(majorToMinor('1.200,50', 'EUR')).toBe(120050);
    expect(majorToMinor('1 200,50', 'EUR')).toBe(120050);
    expect(majorToMinor('12,345,678.9', 'USD')).toBe(1234567890);
  });

  it('respects zero-decimal currencies', () => {
    expect(majorToMinor('1200', 'JPY')).toBe(1200);
    expect(majorToMinor('1 200', 'JPY')).toBe(1200);
    expect(majorToMinor('12.5', 'JPY')).toBeNull();
  });

  it('rejects anything that is not a plain amount instead of guessing', () => {
    // "1,200" and "1.005" could each be read two ways a thousandfold apart.
    for (const bad of ['1e3', '-5', '+5', '12-3', '1,200', '1.005', '12.345', 'abc', '', '.', '12.', '$12', '1,2,3.4', '12,34.5', NaN, Infinity]) {
      expect(majorToMinor(bad as string | number, 'USD')).toBeNull();
    }
  });
});

describe('minorToMajor and helpers', () => {
  it('round-trips through minor units', () => {
    expect(minorToMajor(1234, 'USD')).toBe(12.34);
    expect(minorToMajor(1200, 'JPY')).toBe(1200);
    expect(currencyMinorDigits('JPY')).toBe(0);
    expect(currencyMinorDigits('GBP')).toBe(2);
  });

  it('knows which codes are supported', () => {
    expect(isSupportedCurrency('USD')).toBe(true);
    expect(isSupportedCurrency('usd')).toBe(false);
    expect(isSupportedCurrency('XXX')).toBe(false);
    expect(isSupportedCurrency(null)).toBe(false);
  });
});
