/**
 * The one place the Pro price lives on the web. The pricing page, the
 * landing copy and the structured data all read from here, so a price change
 * is one edit and cannot drift between them. Stripe remains the source of
 * truth for what is actually charged.
 */
export const PRO_PRICE_MONTHLY_USD = 4.99;
export const PRO_PRICE_YEARLY_USD = 39.99;

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}
