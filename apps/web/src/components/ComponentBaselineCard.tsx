import { useState } from 'react';
import {
  type ComponentBaseline,
  BASELINE_WEAR_SNAP_POINTS,
} from '@loam/shared';

interface ComponentBaselineCardProps {
  componentType: string;
  displayName: string;
  baseline: ComponentBaseline;
  onUpdate: (baseline: ComponentBaseline) => void;
}

type InputMode = 'dates' | 'slider' | 'skip';

export function ComponentBaselineCard({
  componentType,
  displayName,
  baseline,
  onUpdate,
}: ComponentBaselineCardProps) {
  const [mode, setMode] = useState<InputMode>(() => {
    if (baseline.method === 'DATES') return 'dates';
    if (baseline.method === 'SLIDER') return 'slider';
    return 'skip';
  });
  const [lastServicedAt, setLastServicedAt] = useState(baseline.lastServicedAt ?? '');
  const [sliderValue, setSliderValue] = useState(baseline.wearPercent);

  const handleModeChange = (newMode: InputMode) => {
    setMode(newMode);

    if (newMode === 'skip') {
      onUpdate({
        wearPercent: 50,
        method: 'DEFAULT',
        confidence: 'LOW',
      });
    }
  };

  const handleDateChange = (value: string) => {
    setLastServicedAt(value);
    if (value) {
      // For now, just use a simple heuristic - assume 25% wear if recently serviced
      // A more sophisticated implementation would calculate based on ride history
      onUpdate({
        wearPercent: 25,
        method: 'DATES',
        confidence: 'HIGH',
        lastServicedAt: value,
      });
    }
  };

  const handleSliderChange = (value: number) => {
    setSliderValue(value);
    onUpdate({
      wearPercent: value,
      method: 'SLIDER',
      confidence: 'MEDIUM',
    });
  };

  const getSnapLabel = (value: number): string => {
    const snap = BASELINE_WEAR_SNAP_POINTS.find((s) => s.value === value);
    return snap?.label ?? `${value}%`;
  };

  return (
    <div className="bg-surface border border-app rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium text-primary">{displayName}</h3>
        <span className="text-xs text-muted uppercase">{componentType}</span>
      </div>

      <p className="text-sm text-muted mb-4">
        Do you know when this was last serviced?
      </p>

      {/* Mode selector */}
      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => handleModeChange('dates')}
          className={`
            flex-1 px-3 py-2 text-sm rounded-lg border transition-all
            ${
              mode === 'dates'
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-app text-muted hover:border-accent/50'
            }
          `}
        >
          Enter Date
        </button>
        <button
          type="button"
          onClick={() => handleModeChange('slider')}
          className={`
            flex-1 px-3 py-2 text-sm rounded-lg border transition-all
            ${
              mode === 'slider'
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-app text-muted hover:border-accent/50'
            }
          `}
        >
          Estimate
        </button>
        <button
          type="button"
          onClick={() => handleModeChange('skip')}
          className={`
            flex-1 px-3 py-2 text-sm rounded-lg border transition-all
            ${
              mode === 'skip'
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-app text-muted hover:border-accent/50'
            }
          `}
        >
          Skip
        </button>
      </div>

      {/* Date input mode */}
      {mode === 'dates' && (
        <div className="space-y-2">
          <label className="block text-sm text-muted">Last serviced date</label>
          <input
            type="date"
            value={lastServicedAt}
            onChange={(e) => handleDateChange(e.target.value)}
            max={new Date().toISOString().split('T')[0]}
            className="w-full px-3 py-2 rounded-lg border border-app bg-surface text-primary focus:border-accent focus:ring-1 focus:ring-accent outline-none"
          />
          <p className="text-xs text-muted">
            We'll refine this automatically as you log rides.
          </p>
        </div>
      )}

      {/* Slider mode */}
      {mode === 'slider' && (
        <div className="space-y-3">
          <div className="flex justify-between text-xs text-muted">
            <span>Just serviced</span>
            <span>Overdue</span>
          </div>
          <input
            type="range"
            min="0"
            max="90"
            step="1"
            value={sliderValue}
            onChange={(e) => handleSliderChange(Number(e.target.value))}
            className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-accent"
          />
          <div className="flex justify-between">
            {BASELINE_WEAR_SNAP_POINTS.map((snap) => (
              <button
                key={snap.value}
                type="button"
                onClick={() => handleSliderChange(snap.value)}
                className={`
                  text-xs px-2 py-1 rounded transition-all
                  ${
                    sliderValue === snap.value
                      ? 'bg-accent text-white'
                      : 'text-muted hover:bg-surface-hover'
                  }
                `}
              >
                {snap.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted text-center">
            Current: <span className="font-medium">{getSnapLabel(sliderValue)}</span>
          </p>
          <p className="text-xs text-muted">
            This doesn't need to be perfect - just your best guess.
          </p>
        </div>
      )}

      {/* Skip mode */}
      {mode === 'skip' && (
        <div className="text-sm text-muted bg-surface-hover rounded-lg p-3">
          Using default estimate (mid-life). You can update this later.
        </div>
      )}
    </div>
  );
}
