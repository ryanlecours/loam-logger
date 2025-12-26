/**
 * CSRF token utilities for frontend requests.
 * Uses double-submit cookie pattern: reads token from cookie and sends in header.
 */

const CSRF_COOKIE_NAME = 'll_csrf';
const CSRF_STORAGE_KEY = 'll_csrf_cache';

/**
 * Set the CSRF token in sessionStorage.
 * Call this after fetching /auth/csrf-token to ensure immediate availability.
 */
export function setCsrfToken(token: string): void {
  sessionStorage.setItem(CSRF_STORAGE_KEY, token);
}

/**
 * Clear the cached CSRF token (call on logout).
 */
export function clearCsrfToken(): void {
  sessionStorage.removeItem(CSRF_STORAGE_KEY);
}

/**
 * Get the CSRF token from cookie or sessionStorage.
 * Returns undefined if token is not available.
 */
export function getCsrfToken(): string | undefined {
  // Read from cookie first (most reliable - set by server with path: '/')
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === CSRF_COOKIE_NAME) {
      return value;
    }
  }

  // Fallback to sessionStorage
  const cached = sessionStorage.getItem(CSRF_STORAGE_KEY);
  if (cached) {
    return cached;
  }

  return undefined;
}

/**
 * Get headers object with CSRF token included.
 * Use this for all state-changing requests (POST, PUT, DELETE, etc.)
 */
export function getAuthHeaders(
  contentType: string = 'application/json'
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': contentType,
  };

  const csrfToken = getCsrfToken();
  if (csrfToken) {
    headers['x-csrf-token'] = csrfToken;
  }

  return headers;
}

/**
 * Wrapper for fetch that automatically includes CSRF token.
 * Use this for authenticated state-changing requests.
 */
export async function fetchWithCsrf(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const csrfToken = getCsrfToken();

  const headers = new Headers(options.headers);
  if (csrfToken) {
    headers.set('x-csrf-token', csrfToken);
  }

  return fetch(url, {
    ...options,
    credentials: 'include',
    headers,
  });
}
