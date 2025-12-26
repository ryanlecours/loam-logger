import type { Response } from 'express';

/**
 * Standardized API error response format.
 * All API errors should use this structure for consistency.
 */
export type ApiErrorResponse = {
  error: string;
  code?: string;
  details?: Record<string, unknown>;
};

/**
 * Standardized API success response format.
 */
export type ApiSuccessResponse<T = unknown> = {
  ok: true;
  data?: T;
  message?: string;
};

/**
 * Send a standardized error response.
 *
 * @param res - Express response object
 * @param status - HTTP status code
 * @param error - Error message
 * @param code - Optional error code for client handling
 * @param details - Optional additional details
 */
export function sendError(
  res: Response,
  status: number,
  error: string,
  code?: string,
  details?: Record<string, unknown>
): void {
  const response: ApiErrorResponse = { error };
  if (code) response.code = code;
  if (details) response.details = details;
  res.status(status).json(response);
}

/**
 * Send a standardized success response.
 *
 * @param res - Express response object
 * @param data - Optional response data
 * @param message - Optional success message
 * @param status - HTTP status code (default 200)
 */
export function sendSuccess<T>(
  res: Response,
  data?: T,
  message?: string,
  status: number = 200
): void {
  const response: ApiSuccessResponse<T> = { ok: true };
  if (data !== undefined) response.data = data;
  if (message) response.message = message;
  res.status(status).json(response);
}

// Common error helpers for frequently used status codes

export function sendUnauthorized(res: Response, error = 'Unauthorized'): void {
  sendError(res, 401, error, 'UNAUTHORIZED');
}

export function sendForbidden(res: Response, error = 'Forbidden', code?: string): void {
  sendError(res, 403, error, code ?? 'FORBIDDEN');
}

export function sendNotFound(res: Response, error = 'Not found'): void {
  sendError(res, 404, error, 'NOT_FOUND');
}

export function sendConflict(res: Response, error: string, code?: string): void {
  sendError(res, 409, error, code ?? 'CONFLICT');
}

export function sendBadRequest(res: Response, error: string, code?: string): void {
  sendError(res, 400, error, code ?? 'BAD_REQUEST');
}

export function sendInternalError(res: Response, error = 'Internal server error'): void {
  sendError(res, 500, error, 'INTERNAL_ERROR');
}
