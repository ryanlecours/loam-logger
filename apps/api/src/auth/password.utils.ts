import bcryptjs from 'bcryptjs';

// Re-export shared password validation for convenience
export { validatePassword, PASSWORD_REQUIREMENTS, PASSWORD_RULES } from '@loam/shared';
export type { PasswordValidationResult } from '@loam/shared';

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
