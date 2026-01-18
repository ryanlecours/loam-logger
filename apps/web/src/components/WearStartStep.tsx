import { type AcquisitionCondition } from '@loam/shared';
import { HiSparkles, HiClock } from 'react-icons/hi2';
import type { IconType } from 'react-icons';

interface WearStartStepProps {
  selected: AcquisitionCondition | null;
  onSelect: (condition: AcquisitionCondition) => void;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
}

interface StockOption {
  value: AcquisitionCondition;
  title: string;
  description: string;
  tooltip: string;
  Icon: IconType;
  recommended?: boolean;
}

const STOCK_OPTIONS: StockOption[] = [
  {
    value: 'NEW',  // Maps to NEW for backend compatibility
    title: 'All Stock',
    description: 'Components are unchanged from the factory.',
    tooltip: 'Best for most bikes. Component specs come from 99spokes database.',
    Icon: HiSparkles,
    recommended: true,
  },
  {
    value: 'USED',  // Maps to USED - signals components need attention
    title: 'Some Swapped',
    description: "I've replaced some parts since buying.",
    tooltip: 'You can update component details in bike settings after creation.',
    Icon: HiClock,
  },
];

export function WearStartStep({
  selected,
  onSelect,
  onBack,
  onSubmit,
  submitting,
}: WearStartStepProps) {
  return (
    <div className="bg-surface border border-app rounded-xl shadow p-6 space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-primary">
          Are your components stock?
        </h2>
        <p className="text-sm text-muted mt-1">
          This helps us set up accurate component tracking. You can always update details later.
        </p>
      </div>

      <div className="grid gap-3">
        {STOCK_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            title={option.tooltip}
            onClick={() => onSelect(option.value)}
            className={`
              w-full p-4 rounded-lg border-2 text-left transition-all
              ${
                selected === option.value
                  ? 'border-accent bg-accent/10'
                  : 'border-app hover:border-accent/50 hover:bg-surface-hover'
              }
            `}
          >
            <div className="flex items-start gap-3">
              <option.Icon className="w-6 h-6 text-accent mt-0.5 shrink-0" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-primary">{option.title}</span>
                  {option.recommended && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-accent/20 text-accent font-medium">
                      Recommended
                    </span>
                  )}
                </div>
                <div className="text-sm text-muted mt-0.5">
                  {option.description}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="flex justify-between pt-2">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="px-4 py-2 text-sm font-medium text-muted hover:text-primary transition-colors disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!selected || submitting}
          className={`
            px-6 py-2 rounded-lg text-sm font-medium transition-all
            ${
              selected && !submitting
                ? 'bg-accent text-white hover:bg-accent-hover'
                : 'bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed'
            }
          `}
        >
          {submitting ? 'Creating...' : 'Create Bike'}
        </button>
      </div>
    </div>
  );
}
