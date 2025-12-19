import bcryptjs from 'bcryptjs';

const SALT_ROUNDS = 12;

/**
 * Hash a password using bcryptjs
 * @param password - Raw password string
 * @returns Hashed password
 */
export async function hashPassword(password: string): Promise<string> {
  return bcryptjs.hash(password, SALT_ROUNDS);
}

/**
 * Verify a password against a hash
 * @param password - Raw password string
 * @param hash - Hashed password from database
 * @returns True if password matches hash
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcryptjs.compare(password, hash);
}

/**
 * Validate password strength
 * Requirements:
 * - At least 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one special character (!@#$%^&*)
 * @param password - Raw password string
 * @returns Object with isValid boolean and error message if invalid
 */
export function validatePassword(
  password: string
): { isValid: boolean; error?: string } {
  if (password.length < 8) {
    return { isValid: false, error: 'Password must be at least 8 characters' };
  }

  if (!/[A-Z]/.test(password)) {
    return {
      isValid: false,
      error: 'Password must contain at least one uppercase letter',
    };
  }

  if (!/[a-z]/.test(password)) {
    return {
      isValid: false,
      error: 'Password must contain at least one lowercase letter',
    };
  }

  if (!/[0-9]/.test(password)) {
    return { isValid: false, error: 'Password must contain at least one number' };
  }

  if (!/[!@#$%^&*]/.test(password)) {
    return {
      isValid: false,
      error: 'Password must contain at least one special character (!@#$%^&*)',
    };
  }

  return { isValid: true };
}
