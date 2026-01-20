import { AsyncLocalStorage } from 'async_hooks';
import crypto from 'crypto';

/**
 * Request context stored in AsyncLocalStorage.
 * All fields except requestId are optional since context is built incrementally.
 */
export interface RequestContext {
  /** Unique identifier for the request (UUID v4) */
  requestId: string;
  /** User ID from auth middleware (set after attachUser runs) */
  userId?: string;
  /** GraphQL operation name (set in Apollo context) */
  operationName?: string;
  /** Request method (GET, POST, etc.) */
  method?: string;
  /** Request path */
  path?: string;
  /** Request start time for duration calculation */
  startTime?: number;
}

/**
 * AsyncLocalStorage instance for request-scoped context.
 * This allows accessing request context anywhere in the call stack
 * without explicitly passing it through function arguments.
 */
export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Generate a unique request ID using crypto.randomUUID().
 */
export function generateRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Get the current request context.
 * Returns undefined if called outside of a request context.
 */
export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

/**
 * Get the current request ID.
 * Returns 'no-request-context' if called outside of a request context.
 */
export function getRequestId(): string {
  return getRequestContext()?.requestId ?? 'no-request-context';
}

/**
 * Get the current user ID.
 * Returns undefined if no user or outside request context.
 */
export function getUserId(): string | undefined {
  return getRequestContext()?.userId;
}

/**
 * Get the current operation name.
 * Returns undefined if not set or outside request context.
 */
export function getOperationName(): string | undefined {
  return getRequestContext()?.operationName;
}

/**
 * Safely merge additional context into the current request context.
 * Mutates the store in place - we're enriching context as the request progresses.
 */
export function enrichRequestContext(additions: Partial<RequestContext>): void {
  const current = getRequestContext();
  if (current) {
    Object.assign(current, additions);
  }
}

/**
 * Run a function within a new request context.
 * Use this to establish context at the start of each request.
 */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return requestContextStorage.run(context, fn);
}

/**
 * Create initial request context with required fields.
 */
export function createRequestContext(
  method: string,
  path: string,
  existingRequestId?: string
): RequestContext {
  return {
    requestId: existingRequestId ?? generateRequestId(),
    method,
    path,
    startTime: Date.now(),
  };
}
