/**
 * Pino-based structured logging with automatic request context enrichment.
 *
 * Every log line automatically includes requestId, userId, and operationName
 * when called within a request context (via AsyncLocalStorage).
 */

import pino, { Logger, LoggerOptions } from 'pino';
import { getRequestContext } from './requestContext';

const isProd = process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production';

/**
 * Sensitive fields to redact from logs.
 * Supports nested paths via dot notation.
 */
const REDACT_PATHS = [
  // HTTP headers
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',
  // Request body fields
  'req.body.password',
  'req.body.token',
  'req.body.refreshToken',
  'req.body.accessToken',
  'req.body.userAccessToken',
  'req.body.email',
  // Response body fields (prevent token leakage in logs)
  'res.body.token',
  'res.body.accessToken',
  'res.body.refreshToken',
  // Generic patterns (for direct logging of these fields)
  'password',
  'token',
  'refreshToken',
  'accessToken',
  'userAccessToken',
  'authorization',
  'cookie',
  // PII fields
  'email',
  'userEmail',
  'phoneNumber',
  'phone',
  // GPS coordinates (protect location privacy)
  'startLatitude',
  'startLongitude',
  'endLatitude',
  'endLongitude',
];

/**
 * Base pino configuration.
 */
const baseOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    service: 'loam-api',
    env: process.env.APP_ENV || process.env.NODE_ENV || 'development',
  },
};

/**
 * Development transport for pretty printing.
 * Only used when not in production.
 */
const devTransport: LoggerOptions['transport'] = {
  target: 'pino-pretty',
  options: {
    colorize: true,
    translateTime: 'SYS:standard',
    ignore: 'pid,hostname,service,env',
  },
};

/**
 * Root logger instance.
 * In production: outputs JSON to stdout
 * In development: outputs pretty-printed colored logs
 */
export const rootLogger: Logger = pino({
  ...baseOptions,
  ...(isProd ? {} : { transport: devTransport }),
});

/**
 * Mixin function that automatically includes request context in every log.
 * This is called by pino for each log statement.
 */
function contextMixin(): object {
  const ctx = getRequestContext();
  if (!ctx) {
    return {};
  }

  // Only include defined values
  const contextData: Record<string, unknown> = {
    requestId: ctx.requestId,
  };

  if (ctx.userId) {
    contextData.userId = ctx.userId;
  }

  if (ctx.operationName) {
    contextData.operationName = ctx.operationName;
  }

  return contextData;
}

/**
 * Context-aware logger that automatically includes request context.
 * Use this logger throughout the application.
 *
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.info({ extra: 'data' }, 'Something happened');
 *   logger.error({ err }, 'Operation failed');
 */
export const logger: Logger = pino({
  ...baseOptions,
  ...(isProd ? {} : { transport: devTransport }),
  mixin: contextMixin,
});

/**
 * Create a child logger with additional static bindings.
 * Useful for module-specific loggers.
 *
 * Usage:
 *   const log = createLogger('SyncWorker');
 *   log.info('Starting sync'); // Logs with { module: 'SyncWorker', ... }
 */
export function createLogger(module: string): Logger {
  return logger.child({ module });
}

// ============================================================================
// Backward-compatible API (for migration)
// ============================================================================

/**
 * Safe error info type - used by safeErrorInfo for backward compatibility.
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
 *
 * @deprecated Use logger.error({ err }, 'message') instead - Pino handles errors properly.
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
 * Log an error safely.
 * Now routes through Pino for structured logging with context.
 *
 * @deprecated Use logger.error({ err }, 'message') instead for better structure.
 * @param context - The context/module name for the log (e.g., 'Strava Webhook')
 * @param err - The error to log
 */
export function logError(context: string, err: unknown): void {
  const errorObj = err instanceof Error ? { err } : { err: { message: String(err) } };
  logger.error(errorObj, `[${context}] Error`);
}

// Export types for consumers
export type { Logger } from 'pino';
