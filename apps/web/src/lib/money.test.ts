import { describe, expect, it } from 'vitest';
import { fmtMoney, fmtPartsList, fmtPerHour, moneyInputText, parseMoneyInput } from './money';

describe('money', () => {
  it('formats minor units in the currency', () => {
    expect(fmtMoney(3800, 'USD', 'en-US')).toBe('$38.00');
    expect(fmtMoney(1200, 'JPY', 'en-US')).toBe('¥1,200');
  });

  it('rounds a fractional per-hour figure to the minor unit', () => {
    expect(fmtPerHour(209.6, 'USD', 'en-US')).toBe('$2.10 / h');
  });

  it('round-trips an input through text and back', () => {
    expect(moneyInputText(3850, 'USD')).toBe('38.50');
    expect(moneyInputText(null)).toBe('');
    expect(parseMoneyInput('38.50', 'USD')).toBe(3850);
    expect(parseMoneyInput('1200', 'JPY')).toBe(1200);
  });

  it('treats blank, negative and garbage input as not recorded', () => {
    expect(parseMoneyInput('', 'USD')).toBeNull();
    expect(parseMoneyInput('   ', 'USD')).toBeNull();
    expect(parseMoneyInput('-5', 'USD')).toBeNull();
    expect(parseMoneyInput('abc', 'USD')).toBeNull();
  });

  it('lists the first parts and counts the rest', () => {
    const parts = [
      { brand: 'Fox', model: 'Seal kit' },
      { brand: '', model: '20wt oil' },
      { brand: 'SRAM', model: 'GX chain' },
    ];
    expect(fmtPartsList(parts)).toBe('Fox Seal kit, 20wt oil +1');
    expect(fmtPartsList(parts.slice(0, 2))).toBe('Fox Seal kit, 20wt oil');
    expect(fmtPartsList([])).toBe('');
  });
});
