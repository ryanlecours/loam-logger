import type { Timeframe, PresetTimeframe } from './types';

const PRESET_OPTIONS: { value: PresetTimeframe; label: string }[] = [
  { value: '1w', label: 'Last 7 Days' },
  { value: '1m', label: 'Last 30 Days' },
  { value: '3m', label: 'Last 90 Days' },
  { value: 'YTD', label: 'Year to Date' },
];

interface TimeframeDropdownProps {
  selected: Timeframe;
  onSelect: (tf: Timeframe) => void;
  /** Years with ride data (for showing previous year options) */
  availableYears?: number[];
}

export default function TimeframeDropdown({
  selected,
  onSelect,
  availableYears = [],
}: TimeframeDropdownProps) {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    // Check if it's a year (numeric) or a preset
    const numValue = Number(value);
    if (!isNaN(numValue) && numValue > 2000) {
      onSelect(numValue);
    } else {
      onSelect(value as PresetTimeframe);
    }
  };

  return (
    <div className="timeframe-dropdown">
      <select
        value={selected}
        onChange={handleChange}
        className="timeframe-select"
      >
        {PRESET_OPTIONS.map(({ value, label }) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
        {availableYears.length > 0 && (
          <option disabled>──────────</option>
        )}
        {availableYears.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </select>
    </div>
  );
}
