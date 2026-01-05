import { type AcquisitionCondition } from '@loam/shared';

interface AcquisitionConditionStepProps {
  selected: AcquisitionCondition | null;
  onSelect: (condition: AcquisitionCondition) => void;
  onBack: () => void;
  onContinue: () => void;
}

interface ConditionOption {
  value: AcquisitionCondition;
  title: string;
  description: string;
  icon: string;
}

const CONDITIONS: ConditionOption[] = [
  {
    value: 'NEW',
    title: 'Brand New',
    description: 'Just purchased or built, all components are fresh',
    icon: '✨',
  },
  {
    value: 'USED',
    title: 'Used Bike',
    description: 'Previously ridden, components have some wear',
    icon: '🔧',
  },
  {
    value: 'MIXED',
    title: 'Mixed / Not Sure',
    description: 'Some components replaced recently, others unknown',
    icon: '🔄',
  },
];

export function AcquisitionConditionStep({
  selected,
  onSelect,
  onBack,
  onContinue,
}: AcquisitionConditionStepProps) {
  return (
    <div className="bg-surface border border-app rounded-xl shadow p-6 space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-primary">
          Is this bike brand new?
        </h2>
        <p className="text-sm text-muted mt-1">
          This helps us set accurate service tracking for your components
        </p>
      </div>

      <div className="grid gap-3">
        {CONDITIONS.map((condition) => (
          <button
            key={condition.value}
            type="button"
            onClick={() => onSelect(condition.value)}
            className={`
              w-full p-4 rounded-lg border-2 text-left transition-all
              ${
                selected === condition.value
                  ? 'border-accent bg-accent/10'
                  : 'border-app hover:border-accent/50 hover:bg-surface-hover'
              }
            `}
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl">{condition.icon}</span>
              <div>
                <div className="font-medium text-primary">{condition.title}</div>
                <div className="text-sm text-muted mt-0.5">
                  {condition.description}
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
          className="px-4 py-2 text-sm font-medium text-muted hover:text-primary transition-colors"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={!selected}
          className={`
            px-6 py-2 rounded-lg text-sm font-medium transition-all
            ${
              selected
                ? 'bg-accent text-white hover:bg-accent-hover'
                : 'bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed'
            }
          `}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
