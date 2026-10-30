// Draft rows for the parts fitted during a service, and their conversion to
// the API's ServicePartInput. Kept apart from the ServicePartsCostFields
// component so the component file exports only components (fast refresh).
import { isMoneyInputValid, moneyInputText, parseMoneyInput } from './money';

/** The API caps a log at this many parts. */
export const MAX_SERVICE_PARTS = 20;

/** One part row as the rider is typing it. Price is text in major units. */
export type PartDraft = {
  key: string;
  brand: string;
  model: string;
  price: string;
  vendor: string;
};

/** What the API accepts for one part. */
export type ServicePartInput = {
  brand: string;
  model: string;
  priceMinor?: number;
  vendor?: string;
};

let draftSeq = 0;
export function newPartDraft(seed: Partial<Omit<PartDraft, 'key'>> = {}): PartDraft {
  draftSeq += 1;
  return { key: `part-${draftSeq}`, brand: '', model: '', price: '', vendor: '', ...seed };
}

/** Stored parts to editable rows. */
export function partsFromLog(
  parts: ReadonlyArray<{ brand: string; model: string; priceMinor?: number | null; vendor?: string | null }>,
  currency: string
): PartDraft[] {
  return parts.map((p) =>
    newPartDraft({
      brand: p.brand,
      model: p.model,
      price: moneyInputText(p.priceMinor ?? null, currency),
      vendor: p.vendor ?? '',
    })
  );
}

/** Editable rows to the mutation input. Rows without a model are dropped. */
export function partsToInput(parts: ReadonlyArray<PartDraft>, currency: string): ServicePartInput[] {
  return parts
    .filter((p) => p.model.trim() !== '')
    .slice(0, MAX_SERVICE_PARTS)
    .map((p) => {
      const priceMinor = parseMoneyInput(p.price, currency);
      const vendor = p.vendor.trim();
      return {
        brand: p.brand.trim(),
        model: p.model.trim(),
        ...(priceMinor != null ? { priceMinor } : {}),
        ...(vendor ? { vendor } : {}),
      };
    });
}

/**
 * False while the cost field or any part's price holds something the strict
 * parser refuses. Forms disable their submit on it: a mistyped amount must
 * fail, never quietly become a different valid one.
 */
export function partsCostInputValid(
  costText: string,
  parts: ReadonlyArray<PartDraft>,
  currency: string
): boolean {
  return isMoneyInputValid(costText, currency) && parts.every((p) => isMoneyInputValid(p.price, currency));
}

/** Sum of the priced parts, or null when none carries a price. */
export function partsSumMinor(parts: ReadonlyArray<PartDraft>, currency: string): number | null {
  let sum: number | null = null;
  for (const p of parts) {
    if (p.model.trim() === '') continue;
    const minor = parseMoneyInput(p.price, currency);
    if (minor == null) continue;
    sum = (sum ?? 0) + minor;
  }
  return sum;
}

const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * True when a typed part names something other than the component itself.
 * A seal kit fitted to a Fox 36 is a service; a Fox 38 fitted in its place
 * is a replacement, which has its own flow so the new part's hours start at
 * zero. The hint fires only once both the brand and the model are typed, so
 * it does not nag mid-word.
 */
export function partLooksLikeReplacement(
  part: Pick<PartDraft, 'brand' | 'model'>,
  component: { brand?: string | null; model?: string | null } | null | undefined
): boolean {
  if (!component) return false;
  const brand = normalize(part.brand);
  const model = normalize(part.model);
  if (!brand || !model) return false;
  const compBrand = normalize(component.brand ?? '');
  const compModel = normalize(component.model ?? '');
  if (!compBrand && !compModel) return false;
  return brand !== compBrand && model !== compModel;
}
