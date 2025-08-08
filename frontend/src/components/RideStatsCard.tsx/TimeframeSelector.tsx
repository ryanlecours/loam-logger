const timeframes = ['1w', '1m', '3m', 'YTD'] as const;
type Timeframe = typeof timeframes[number];

interface Props {
  selected: Timeframe;
  onSelect: (tf: Timeframe) => void;
}

export default function TimeframeSelector({ selected, onSelect }: Props) {
  return (
    <div className="flex gap-2 mb-4">
      {timeframes.map(tf => (
        <button
          key={tf}
          onClick={() => onSelect(tf)}
          className={`px-3 py-1 rounded border ${selected === tf ? 'bg-blue-500 text-white' : 'bg-white border-gray-300'}`}
        >
          {tf}
        </button>
      ))}
    </div>
  );
}
