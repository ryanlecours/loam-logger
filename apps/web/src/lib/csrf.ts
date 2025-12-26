/**
 * CSRF token utilities for frontend requests.
 * Uses double-submit cookie pattern: reads token from cookie and sends in header.
 */

const CSRF_COOKIE_NAME = 'll_csrf';

/**
 * Get the CSRF token from the cookie.
 * Returns undefined if cookie is not set.
 */
export function getCsrfToken(): string | undefined {
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === CSRF_COOKIE_NAME) {
      return value;
    }
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
