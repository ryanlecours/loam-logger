/**
 * Validate email format
 * @param email - Email address to validate
 * @returns True if email format is valid
 */
export function validateEmailFormat(email: string): boolean {
  // RFC 5322 simplified regex for email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}
