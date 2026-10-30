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

/** "12.34" (or 12.34) in a currency to its integer minor units; null when unparseable. */
export function majorToMinor(value: string | number, code: string): number | null {
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(n)) return null;
  const factor = 10 ** currencyMinorDigits(code);
  return Math.round(n * factor);
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
