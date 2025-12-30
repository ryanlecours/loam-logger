import type { ComponentType } from '@prisma/client';
import type { PredictionStatus, WearDriver, RideMetrics } from './types';
import { getComponentWeights } from './config';
import { calculateWearDetailed, generateWearDrivers } from './wear';

/**
 * Generate explanation for a component prediction.
 * Only called for PRO tier users.
 *
 * @param componentType - Type of component
 * @param recentRides - Recent rides for wear analysis
 * @param hoursRemaining - Hours remaining until service
 * @param status - Prediction status
 * @returns Explanation with why string and drivers array
 */
export function generateExplanation(
  componentType: ComponentType,
  recentRides: RideMetrics[],
  hoursRemaining: number,
  status: PredictionStatus
): { why: string; drivers: WearDriver[] } {
  const weights = getComponentWeights(componentType);
  const wearResult = calculateWearDetailed(recentRides, weights);
  const drivers = generateWearDrivers(wearResult.breakdown);

  const componentName = formatComponentName(componentType);
  const topDriver = drivers[0];
  const secondDriver = drivers[1];

  let why: string;

  switch (status) {
    case 'OVERDUE':
      why = `Your ${componentName} is overdue for service. `;
      why += `${topDriver.label} (${topDriver.contribution}%) has been the primary wear factor.`;
      break;

    case 'DUE_NOW':
      why = `Service recommended now. `;
      why += `Based on your riding style, ${topDriver.label.toLowerCase()} `;
      why += `and ${secondDriver.label.toLowerCase()} are the main wear factors.`;
      break;

    case 'DUE_SOON':
      why = `Service coming up in ~${Math.round(hoursRemaining)} hours. `;
      why += `Your ${topDriver.label.toLowerCase()} contributes most to wear (${topDriver.contribution}%).`;
      break;

    case 'ALL_GOOD':
    default:
      why = `Component is in good condition with ~${Math.round(hoursRemaining)} hours until service. `;
      if (topDriver.contribution > 50) {
        why += `${topDriver.label} is your main wear driver.`;
      }
      break;
  }

  return { why, drivers };
}

/**
 * Generate contextual explanation based on wear patterns.
 *
 * @param componentType - Type of component
 * @param drivers - Wear drivers sorted by contribution
 * @returns Additional context string
 */
export function generateWearContext(
  componentType: ComponentType,
  drivers: WearDriver[]
): string {
  const topDriver = drivers[0];

  // Component-specific context based on top driver
  switch (componentType) {
    case 'BRAKE_PAD':
    case 'BRAKE_ROTOR':
      if (topDriver.factor === 'climbing' || topDriver.factor === 'steepness') {
        return 'More descending lately has increased brake wear.';
      }
      break;

    case 'CHAIN':
    case 'DRIVETRAIN':
      if (topDriver.factor === 'distance') {
        return 'More miles per ride lately.';
      }
      if (topDriver.factor === 'climbing') {
        return 'More climbing puts extra stress on the drivetrain.';
      }
      break;

    case 'FORK':
    case 'SHOCK':
    case 'DROPPER':
      if (topDriver.factor === 'hours') {
        return 'Longer rides lately.';
      }
      break;

    case 'PIVOT_BEARINGS':
    case 'HEADSET':
      if (topDriver.factor === 'steepness') {
        return 'Steeper, rougher rides lately.';
      }
      break;

    case 'TIRES':
      if (topDriver.factor === 'distance') {
        return 'More miles covered lately.';
      }
      if (topDriver.factor === 'steepness') {
        return 'More aggressive riding lately.';
      }
      break;
  }

  return '';
}

/**
 * Format component type for display.
 */
function formatComponentName(type: ComponentType): string {
  return type
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
