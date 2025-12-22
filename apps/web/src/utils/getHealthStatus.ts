export function getHealthStatus(hours: number): 'ok' | 'warning' | 'danger' {
  if (hours < 50) return 'ok';
  if (hours < 200) return 'warning';
  return 'danger';
}
export function getBgColor(hours: number): string {
  if (hours < 50) return 'bg-green-50';
  if (hours < 200) return 'bg-yellow-50';
  return 'bg-red-50';
}
export function getBorderColor(hours: number): string {
  if (hours < 50) return 'border-green-500';
  if (hours < 200) return 'border-yellow-500';
  return 'border-red-500';
}