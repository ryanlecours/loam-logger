import type { Timeframe } from './types';

const TIMEFRAME_OPTIONS: { value: Timeframe; label: string }[] = [
  { value: '1w', label: 'Last 7 Days' },
  { value: '1m', label: 'Last 30 Days' },
  { value: '3m', label: 'Last 90 Days' },
  { value: 'YTD', label: 'Year to Date' },
  { value: 'ALL', label: 'All Time' },
];

interface TimeframeDropdownProps {
  selected: Timeframe;
  onSelect: (tf: Timeframe) => void;
}

export default function TimeframeDropdown({
  selected,
  onSelect,
}: TimeframeDropdownProps) {
  return (
    <div className="timeframe-dropdown">
      <select
        value={selected}
        onChange={(e) => onSelect(e.target.value as Timeframe)}
        className="timeframe-select"
      >
        {TIMEFRAME_OPTIONS.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
