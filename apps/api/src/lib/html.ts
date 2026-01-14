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
  // Remove control characters (except newline \x0A and tab \x09 which might be intentional)
  // Control chars: 0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F, 0x7F
  let result = '';
  for (const char of input) {
    const code = char.charCodeAt(0);
    // Skip control characters except tab (9) and newline (10)
    if (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) {
      continue;
    }
    result += char;
  }
  return result.slice(0, maxLength);
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
