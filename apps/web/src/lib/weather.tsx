import { Sun, Cloud, CloudRain, CloudSnow, Wind, CloudFog, HelpCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import type { WeatherCondition } from '../models/Ride';

export const conditionLabel = (c: WeatherCondition): string => {
  switch (c) {
    case 'SUNNY': return 'Sunny';
    case 'CLOUDY': return 'Cloudy';
    case 'RAINY': return 'Rainy';
    case 'SNOWY': return 'Snowy';
    case 'WINDY': return 'Windy';
    case 'FOGGY': return 'Foggy';
    default: return 'Unknown';
  }
};

type IconProps = { size?: number; color?: string; className?: string };

// Returns a rendered icon node rather than a component reference so callers
// never have to bind a dynamic component to a variable (which trips
// react-hooks/static-components).
export const renderConditionIcon = (c: WeatherCondition, props: IconProps = {}): ReactNode => {
  switch (c) {
    case 'SUNNY': return <Sun {...props} />;
    case 'CLOUDY': return <Cloud {...props} />;
    case 'RAINY': return <CloudRain {...props} />;
    case 'SNOWY': return <CloudSnow {...props} />;
    case 'WINDY': return <Wind {...props} />;
    case 'FOGGY': return <CloudFog {...props} />;
    default: return <HelpCircle {...props} />;
  }
};

export const conditionTint = (c: WeatherCondition): string => {
  switch (c) {
    case 'SUNNY': return '#f4b740';
    case 'CLOUDY': return '#7a8ba3';
    case 'RAINY': return '#4a90e2';
    case 'SNOWY': return '#9ec9e6';
    case 'WINDY': return '#6aa7a0';
    case 'FOGGY': return '#8c9aa6';
    default: return '#888';
  }
};

export const celsiusToFahrenheit = (c: number): number => c * 9 / 5 + 32;
export const mmToInches = (mm: number): number => mm / 25.4;
export const kphToMph = (kph: number): number => kph * 0.621371;
