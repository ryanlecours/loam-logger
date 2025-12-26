import { validatePassword, PASSWORD_REQUIREMENTS } from './password';

describe('validatePassword', () => {
  describe('length requirement', () => {
    it('should fail for empty password', () => {
      const result = validatePassword('');
      expect(result.isValid).toBe(false);
      expect(result.checks.length).toBe(false);
      expect(result.error).toContain('at least 8 characters');
    });

    it('should fail for password with 7 characters', () => {
      const result = validatePassword('Abc123!');
      expect(result.isValid).toBe(false);
      expect(result.checks.length).toBe(false);
    });

    it('should pass for password with exactly 8 characters', () => {
      const result = validatePassword('Abcd123!');
      expect(result.isValid).toBe(true);
      expect(result.checks.length).toBe(true);
    });

    it('should pass for very long password', () => {
      const result = validatePassword('Abcdefghijklmnopqrstuvwxyz123456!');
      expect(result.isValid).toBe(true);
      expect(result.checks.length).toBe(true);
    });
  });

  describe('uppercase requirement', () => {
    it('should fail for password without uppercase', () => {
      const result = validatePassword('abcdefg1!');
      expect(result.isValid).toBe(false);
      expect(result.checks.uppercase).toBe(false);
      expect(result.error).toContain('uppercase letter');
    });

    it('should pass for password with uppercase', () => {
      const result = validatePassword('Abcdefg1!');
      expect(result.isValid).toBe(true);
      expect(result.checks.uppercase).toBe(true);
    });
  });

  describe('lowercase requirement', () => {
    it('should fail for password without lowercase', () => {
      const result = validatePassword('ABCDEFG1!');
      expect(result.isValid).toBe(false);
      expect(result.checks.lowercase).toBe(false);
      expect(result.error).toContain('lowercase letter');
    });

    it('should pass for password with lowercase', () => {
      const result = validatePassword('ABCDEFg1!');
      expect(result.isValid).toBe(true);
      expect(result.checks.lowercase).toBe(true);
    });
  });

  describe('number requirement', () => {
    it('should fail for password without number', () => {
      const result = validatePassword('Abcdefgh!');
      expect(result.isValid).toBe(false);
      expect(result.checks.number).toBe(false);
      expect(result.error).toContain('number');
    });

    it('should pass for password with number', () => {
      const result = validatePassword('Abcdefg1!');
      expect(result.isValid).toBe(true);
      expect(result.checks.number).toBe(true);
    });
  });

  describe('special character requirement', () => {
    it('should fail for password without special character', () => {
      const result = validatePassword('Abcdefg1');
      expect(result.isValid).toBe(false);
      expect(result.checks.special).toBe(false);
      expect(result.error).toContain('special character');
    });

    it.each(['!', '@', '#', '$', '%', '^', '&', '*'])(
      'should pass for password with special character: %s',
      (char) => {
        const result = validatePassword(`Abcdefg1${char}`);
        expect(result.isValid).toBe(true);
        expect(result.checks.special).toBe(true);
      }
    );

    it('should fail for password with invalid special character', () => {
      const result = validatePassword('Abcdefg1~');
      expect(result.isValid).toBe(false);
      expect(result.checks.special).toBe(false);
    });
  });

  describe('multiple missing requirements', () => {
    it('should report first failing requirement (length)', () => {
      const result = validatePassword('abc');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('at least 8 characters');
      expect(result.checks.length).toBe(false);
      expect(result.checks.uppercase).toBe(false);
      expect(result.checks.number).toBe(false);
      expect(result.checks.special).toBe(false);
    });
  });

  describe('valid passwords', () => {
    it('should pass for a valid password with all requirements', () => {
      const result = validatePassword('MyPass123!');
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.checks).toEqual({
        length: true,
        uppercase: true,
        lowercase: true,
        number: true,
        special: true,
      });
    });

    it('should pass for password with multiple special characters', () => {
      const result = validatePassword('MyPass!@#123');
      expect(result.isValid).toBe(true);
    });

    it('should pass for password with spaces', () => {
      const result = validatePassword('My Pass 123!');
      expect(result.isValid).toBe(true);
    });
  });

  describe('PASSWORD_REQUIREMENTS constant', () => {
    it('should have correct minLength', () => {
      expect(PASSWORD_REQUIREMENTS.minLength).toBe(8);
    });

    it('should have correct specialChars', () => {
      expect(PASSWORD_REQUIREMENTS.specialChars).toBe('!@#$%^&*');
    });
  });
});
