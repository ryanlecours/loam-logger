import { type AcquisitionCondition } from '@loam/shared';
import { HiSparkles, HiClock, HiAdjustmentsHorizontal } from 'react-icons/hi2';
import type { IconType } from 'react-icons';

interface WearStartStepProps {
  selected: AcquisitionCondition | null;
  onSelect: (condition: AcquisitionCondition) => void;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
}

interface WearOption {
  value: AcquisitionCondition;
  title: string;
  description: string;
  Icon: IconType;
  recommended?: boolean;
}

const WEAR_OPTIONS: WearOption[] = [
  {
    value: 'NEW',
    title: 'Start Fresh',
    description: 'All components start at zero wear.',
    Icon: HiSparkles,
    recommended: true,
  },
  {
    value: 'USED',
    title: 'Already Ridden',
    description: 'Components start with a conservative wear estimate.',
    Icon: HiClock,
  },
  {
    value: 'MIXED',
    title: "I'll fine-tune later",
    description: 'Set individual component wear after adding the bike.',
    Icon: HiAdjustmentsHorizontal,
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
          How should we start tracking wear?
        </h2>
        <p className="text-sm text-muted mt-1">
          Loam Logger tracks wear automatically based on your rides. Pick a safe starting point.
        </p>
      </div>

      <div className="grid gap-3">
        {WEAR_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
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
