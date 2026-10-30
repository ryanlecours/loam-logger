// Money display helpers. Amounts travel as integer minor units (cents) beside
// an ISO 4217 code; the conversion rules live in @loam/shared so the API and
// both clients agree on them.
import { DEFAULT_CURRENCY, currencyMinorDigits, majorToMinor, minorToMajor } from '@loam/shared';

/** "$38.00", "€12", "¥1,200": a recorded amount in its own currency. */
export function fmtMoney(minor: number, currency: string = DEFAULT_CURRENCY, locale?: string): string {
  const digits = currencyMinorDigits(currency);
  const major = minorToMajor(minor, currency);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(major);
  } catch {
    return `${major.toFixed(digits)} ${currency}`;
  }
}

/** "$2.10 / h" from a per-hour figure in (possibly fractional) minor units. */
export function fmtPerHour(perHourMinor: number, currency: string = DEFAULT_CURRENCY, locale?: string): string {
  return `${fmtMoney(Math.round(perHourMinor), currency, locale)} / h`;
}

/**
 * The text a rider sees in an input for a stored amount: "38.00", "1200"
 * for JPY. Empty for null, so it can feed a controlled input directly.
 */
export function moneyInputText(minor: number | null | undefined, currency: string = DEFAULT_CURRENCY): string {
  if (minor == null) return '';
  return minorToMajor(minor, currency).toFixed(currencyMinorDigits(currency));
}

/**
 * Typed text to integer minor units. Null for an empty field or anything
 * that does not read as a number, so callers never send 0 for "unknown".
 */
export function parseMoneyInput(text: string, currency: string = DEFAULT_CURRENCY): number | null {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed.startsWith('-')) return null;
  const minor = majorToMinor(trimmed, currency);
  if (minor == null || minor < 0) return null;
  // Nothing numeric at all ("abc") collapses to 0 upstream; a rider who typed
  // no digits recorded nothing.
  if (minor === 0 && !/\d/.test(trimmed)) return null;
  return minor;
}

/**
 * Parts on one row: "Fox seal kit, 20wt oil +1". Brand and model joined,
 * the first `max` listed, the rest counted.
 */
export function fmtPartsList(
  parts: ReadonlyArray<{ brand: string; model: string }>,
  max = 2
): string {
  if (parts.length === 0) return '';
  const names = parts.map((p) => [p.brand, p.model].map((s) => s.trim()).filter(Boolean).join(' '));
  const shown = names.slice(0, max).join(', ');
  const rest = names.length - max;
  return rest > 0 ? `${shown} +${rest}` : shown;
}
