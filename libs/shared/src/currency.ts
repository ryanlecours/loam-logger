/**
 * Currencies a rider can record costs in.
 *
 * Amounts are stored as integer minor units (cents) beside an ISO 4217 code.
 * The list is deliberately short: the stores Loam Logger ships in plus the
 * currencies riders asked about. Adding one is a one-line change here, picked
 * up by the API's validation and both clients' pickers.
 *
 * Sums never cross currencies. Converting would be invented precision, so a
 * total covers one currency and reports how many entries it left out.
 */
export const SUPPORTED_CURRENCIES = [
  'USD',
  'CAD',
  'EUR',
  'GBP',
  'AUD',
  'NZD',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'JPY',
  'ZAR',
  'MXN',
  'BRL',
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

/** What the clients assume until the rider picks a currency in Settings. */
export const DEFAULT_CURRENCY: CurrencyCode = 'USD';

/** Currencies whose minor unit is the whole unit (no cents). */
const ZERO_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set(['JPY']);

export function isSupportedCurrency(code: unknown): code is CurrencyCode {
  return typeof code === 'string' && (SUPPORTED_CURRENCIES as readonly string[]).includes(code);
}

/** 2 for most currencies, 0 for JPY. */
export function currencyMinorDigits(code: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(code) ? 0 : 2;
}

/**
 * What a rider typed ("12.34", "12,34", "1 200", 12.34) to integer minor
 * units; null when it is not a plain amount. Strict on purpose: a mistyped
 * amount must fail, never quietly become a different valid one. So no
 * exponents, no signs, at most the currency's decimal places, and either a
 * dot or a comma as the decimal separator. The LAST separator is the decimal
 * one; earlier separators and spaces are thousands groups and must each be
 * followed by exactly three digits. A lone "1,200" or "1.005" is therefore
 * rejected rather than guessed at: it could be one thousand two hundred or an
 * amount with too many decimals, and the two readings differ by a factor of
 * a thousand. Parsed by splitting the string, not by multiplying a float.
 */
export function majorToMinor(value: string | number, code: string): number | null {
  const digits = currencyMinorDigits(code);
  const raw = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value.trim();
  if (!/^[0-9][0-9 .,]*$/.test(raw)) return null;

  const sepIndex = Math.max(raw.lastIndexOf('.'), raw.lastIndexOf(','));
  const wholePart = sepIndex >= 0 ? raw.slice(0, sepIndex) : raw;
  const fraction = sepIndex >= 0 ? raw.slice(sepIndex + 1) : '';
  // "12." is unfinished typing, not twelve.
  if (sepIndex >= 0 && fraction === '') return null;

  // Every group after the first in the whole part must be exactly three digits.
  const groups = wholePart.split(/[ .,]/);
  if (groups.some((g, i) => !/^[0-9]+$/.test(g) || (i > 0 && g.length !== 3))) return null;
  const whole = groups.join('');
  if (fraction !== '' && (!/^[0-9]+$/.test(fraction) || fraction.length > digits)) return null;

  const minor = Number(whole) * 10 ** digits + (fraction === '' ? 0 : Number(fraction.padEnd(digits, '0')));
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Integer minor units to the major-unit number the rider reads. */
export function minorToMajor(minor: number, code: string): number {
  return minor / 10 ** currencyMinorDigits(code);
}

/**
 * Upper bound on a single recorded amount: 1,000,000 units of the currency in
 * minor units. Guards sums and the per-hour division against typos like 1e15.
 */
export const MAX_AMOUNT_MINOR = 100_000_000;
