/**
 * Shared password requirements used by both frontend and backend.
 * This ensures consistency across the application.
 */

export const PASSWORD_REQUIREMENTS = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecialChar: true,
  specialChars: '!@#$%^&*',
} as const;

export type PasswordRule = {
  key: string;
  label: string;
};

export const PASSWORD_RULES: readonly PasswordRule[] = [
  { key: 'length', label: `At least ${PASSWORD_REQUIREMENTS.minLength} characters` },
  { key: 'uppercase', label: 'At least one uppercase letter' },
  { key: 'lowercase', label: 'At least one lowercase letter' },
  { key: 'number', label: 'At least one number' },
  { key: 'special', label: `At least one special character (${PASSWORD_REQUIREMENTS.specialChars})` },
];

export type PasswordValidationResult = {
  isValid: boolean;
  error?: string;
  checks: {
    length: boolean;
    uppercase: boolean;
    lowercase: boolean;
    number: boolean;
    special: boolean;
  };
};

/**
 * Validate password against all requirements.
 * Can be used on both frontend and backend.
 */
export function validatePassword(password: string): PasswordValidationResult {
  const checks = {
    length: password.length >= PASSWORD_REQUIREMENTS.minLength,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: new RegExp(`[${PASSWORD_REQUIREMENTS.specialChars.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}]`).test(password),
  };

  if (!checks.length) {
    return { isValid: false, error: `Password must be at least ${PASSWORD_REQUIREMENTS.minLength} characters`, checks };
  }
  if (!checks.uppercase) {
    return { isValid: false, error: 'Password must contain at least one uppercase letter', checks };
  }
  if (!checks.lowercase) {
    return { isValid: false, error: 'Password must contain at least one lowercase letter', checks };
  }
  if (!checks.number) {
    return { isValid: false, error: 'Password must contain at least one number', checks };
  }
  if (!checks.special) {
    return { isValid: false, error: `Password must contain at least one special character (${PASSWORD_REQUIREMENTS.specialChars})`, checks };
  }

  return { isValid: true, checks };
}
