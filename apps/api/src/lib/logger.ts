/**
 * Safe error logging utilities.
 * Prevents circular references and large objects (like HTTP requests) from being logged.
 */

interface SafeErrorInfo {
  message: string;
  name?: string;
  code?: string;
  stack?: string;
}

/**
 * Safely extract loggable properties from an error.
 * Prevents circular references and large objects from being logged.
 */
export function safeErrorInfo(err: unknown): SafeErrorInfo {
  if (err instanceof Error) {
    return {
      message: err.message || 'Unknown error',
      name: err.name,
      code: (err as NodeJS.ErrnoException).code,
      stack: err.stack,
    };
  }
  return { message: String(err) };
}

/**
 * Log an error safely without dumping full objects.
 * Use this instead of console.error('[Context] Error:', error)
 *
 * @param context - The context/module name for the log (e.g., 'Strava Webhook')
 * @param err - The error to log
 */
export function logError(context: string, err: unknown): void {
  const info = safeErrorInfo(err);
  console.error(`[${context}]`, info.message, info.stack ?? '');
}
