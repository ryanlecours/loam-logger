import { type InputHTMLAttributes, type ReactNode } from 'react';
import { DEFAULT_CURRENCY } from '@loam/shared';

export interface MoneyInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'prefix'> {
  /** The typed text in major units ("38.50"). Convert with parseMoneyInput. */
  value: string;
  onChange: (value: string) => void;
  /** ISO 4217 code shown as the prefix. */
  currency?: string;
  /** Replaces the plain code, e.g. a currency picker. */
  prefix?: ReactNode;
  containerClassName?: string;
}

/**
 * A decimal field with the currency code in front of it. Text in, text out:
 * the caller converts with parseMoneyInput / moneyInputText (lib/money.ts),
 * which wrap @loam/shared's majorToMinor / minorToMajor, so the stored value
 * is always integer minor units and never a float.
 *
 * Money wears the body ink, never the health ramp: cost is history, not
 * status.
 */
export function MoneyInput({
  value,
  onChange,
  currency = DEFAULT_CURRENCY,
  prefix,
  containerClassName = '',
  className = '',
  disabled,
  ...props
}: MoneyInputProps) {
  return (
    <div
      className={`flex items-stretch rounded-md border border-app bg-surface focus-within:border-forest focus-within:ring-1 focus-within:ring-forest ${
        disabled ? 'opacity-60' : ''
      } ${containerClassName}`.trim()}
    >
      {prefix ?? (
        <span className="flex select-none items-center border-r border-app px-2 text-xs text-muted">
          {currency}
        </span>
      )}
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.00"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-app placeholder:text-muted focus:outline-none ${className}`.trim()}
        {...props}
      />
    </div>
  );
}
