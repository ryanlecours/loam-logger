// Time-of-day greeting helper
export function getTimeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

// Format distance with units
export function formatDistance(miles: number): string {
  return `${miles.toFixed(1)} miles`;
}

// Format duration in human-readable form
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  if (hours > 0) {
    return mins > 0 ? `${hours}h ${mins}m` : `${hours} hour${hours > 1 ? 's' : ''}`;
  }
  return `${mins} minutes`;
}

// Format elevation with units
export function formatElevation(feet: number): string {
  return `${feet.toLocaleString()} ft`;
}

// Format percentage change
export function formatPercentChange(pct: number): string {
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct}%`;
}

// Default motivational messages for when no specific insight is available
export const DEFAULT_MESSAGES = [
  'Perfect day for a ride',
  'The trails are calling',
  'Ready to shred?',
  'Time to get some dirt therapy',
  'Let\'s make some memories on the trail',
];

// Get a random default message
export function getRandomDefaultMessage(): string {
  const index = Math.floor(Math.random() * DEFAULT_MESSAGES.length);
  return DEFAULT_MESSAGES[index];
}
