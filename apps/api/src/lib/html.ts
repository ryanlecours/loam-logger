/**
 * Escapes HTML special characters to prevent XSS attacks in email templates.
 */
export function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Sanitizes user input for safe use in email templates.
 * Removes control characters and limits length to prevent abuse.
 */
export function sanitizeUserInput(input: string | undefined | null, maxLength = 100): string {
  if (!input) return '';
  // Remove control characters (except newline/tab which might be intentional)
  // and limit length
  return input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .slice(0, maxLength);
}

/**
 * Validates email format.
 * Returns true if the email appears to be a valid format.
 */
export function isValidEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  // Basic email validation - not exhaustive but catches obvious issues
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email);
}

/**
 * Validates URL format (must be http or https).
 * Returns true if the URL appears to be valid.
 */
export function isValidUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
