import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import { SUPPORTED_CURRENCIES } from '@loam/shared';

import { MoneyInput } from '../ui/MoneyInput';
import { fmtMoney, moneyInputError, moneyInputText, parseMoneyInput } from '../../lib/money';
import {
  MAX_SERVICE_PARTS,
  newPartDraft,
  partLooksLikeReplacement,
  type PartDraft,
} from '../../lib/serviceParts';

const fieldClass =
  'w-full min-w-0 rounded-md border border-app bg-surface px-2 py-1.5 text-sm text-app placeholder:text-muted focus:border-forest focus:outline-none focus:ring-1 focus:ring-forest';

type Props = {
  /** Stable prefix for input ids and labels. */
  idPrefix: string;
  open: boolean;
  onToggle: () => void;
  /**
   * Set when the section cannot be used right now (several components
   * selected). The toggle is inert and `disabledHint` is shown in its place.
   */
  disabled?: boolean;
  disabledHint?: string;
  currency: string;
  onCurrencyChange: (code: string) => void;
  /** The cost field's text. Empty means "follow the parts' prices". */
  costText: string;
  onCostTextChange: (text: string) => void;
  /** What the field shows while costText is empty: the priced parts' sum. */
  prefillMinor: number | null;
  parts: PartDraft[];
  onPartsChange: (parts: PartDraft[]) => void;
  /** The component being serviced, for the replacement hint. */
  component?: { brand?: string | null; model?: string | null } | null;
};

/**
 * The collapsed "Parts and cost" disclosure shared by the log and edit
 * service modals. Closed by default so logging a service stays two taps.
 */
export function ServicePartsCostFields({
  idPrefix,
  open,
  onToggle,
  disabled = false,
  disabledHint,
  currency,
  onCurrencyChange,
  costText,
  onCostTextChange,
  prefillMinor,
  parts,
  onPartsChange,
  component,
}: Props) {
  const typedMinor = parseMoneyInput(costText, currency);
  const effectiveMinor = costText.trim() === '' ? prefillMinor : typedMinor;
  const costError = moneyInputError(costText, currency);
  const shownText = costText.trim() === '' ? moneyInputText(prefillMinor, currency) : costText;
  const partCount = parts.filter((p) => p.model.trim() !== '').length;

  const summary =
    !open && (effectiveMinor != null || partCount > 0)
      ? [
          effectiveMinor != null ? fmtMoney(effectiveMinor, currency) : null,
          partCount > 0 ? `${partCount} part${partCount === 1 ? '' : 's'}` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : null;

  const showReplaceHint = parts.some((p) => partLooksLikeReplacement(p, component));

  const updatePart = (key: string, patch: Partial<PartDraft>) =>
    onPartsChange(parts.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const removePart = (key: string) => onPartsChange(parts.filter((p) => p.key !== key));
  const addPart = () => {
    if (parts.length >= MAX_SERVICE_PARTS) return;
    onPartsChange([...parts, newPartDraft()]);
  };

  const panelId = `${idPrefix}-parts-cost-panel`;

  return (
    <div className="rounded-md border border-app">
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-app disabled:cursor-not-allowed disabled:text-muted"
      >
        {open ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
        <span className="font-medium">Parts and cost</span>
        {summary && <span className="ml-auto truncate text-xs text-muted">{summary}</span>}
      </button>

      {disabled && disabledHint && (
        <p className="px-3 pb-2 text-xs text-muted">{disabledHint}</p>
      )}

      {open && !disabled && (
        <div id={panelId} className="space-y-3 border-t border-app px-3 py-3">
          <div>
            <label htmlFor={`${idPrefix}-cost`} className="mb-1 block text-xs text-muted">
              Cost
            </label>
            <MoneyInput
              id={`${idPrefix}-cost`}
              value={shownText}
              onChange={onCostTextChange}
              currency={currency}
              error={costError}
              prefix={
                <select
                  aria-label="Currency"
                  value={currency}
                  onChange={(e) => onCurrencyChange(e.target.value)}
                  className="rounded-l-md border-r border-app bg-surface-2 px-1.5 text-xs text-muted focus:outline-none"
                >
                  {SUPPORTED_CURRENCIES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              }
            />
            <p className="mt-1 text-xs text-muted">
              Parts plus labour, whatever you actually paid. Leave it blank if you don't know.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">Parts fitted</span>
              <span className="text-xs text-muted">
                {parts.length}/{MAX_SERVICE_PARTS}
              </span>
            </div>

            {parts.map((part, index) => (
              <div key={part.key} className="grid grid-cols-[1fr_1fr_auto] gap-2 sm:grid-cols-[1fr_1.4fr_6rem_1fr_auto]">
                <input
                  aria-label={`Part ${index + 1} brand`}
                  value={part.brand}
                  onChange={(e) => updatePart(part.key, { brand: e.target.value })}
                  placeholder="Brand"
                  maxLength={80}
                  className={fieldClass}
                />
                <input
                  aria-label={`Part ${index + 1} model`}
                  value={part.model}
                  onChange={(e) => updatePart(part.key, { model: e.target.value })}
                  placeholder="Model (required)"
                  maxLength={120}
                  required
                  className={fieldClass}
                />
                <button
                  type="button"
                  onClick={() => removePart(part.key)}
                  aria-label={`Remove part ${index + 1}`}
                  className="row-span-2 self-start rounded-md p-1.5 text-muted transition hover:text-app sm:row-span-1 sm:self-center"
                >
                  <X size={14} />
                </button>
                <MoneyInput
                  id={`${idPrefix}-part-${index + 1}-price`}
                  aria-label={`Part ${index + 1} price`}
                  value={part.price}
                  onChange={(v) => updatePart(part.key, { price: v })}
                  currency={currency}
                  error={moneyInputError(part.price, currency)}
                  containerClassName="col-span-1"
                />
                <input
                  aria-label={`Part ${index + 1} where bought`}
                  value={part.vendor}
                  onChange={(e) => updatePart(part.key, { vendor: e.target.value })}
                  placeholder="Where bought"
                  maxLength={120}
                  className={fieldClass}
                />
              </div>
            ))}

            <button
              type="button"
              onClick={addPart}
              disabled={parts.length >= MAX_SERVICE_PARTS}
              className="inline-flex items-center gap-1 text-xs text-mint transition hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline"
            >
              <Plus size={12} /> Add part
            </button>

            {showReplaceHint && (
              <p className="text-xs text-muted">
                Replacing the whole part? Use Replace so its hours start at zero.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
