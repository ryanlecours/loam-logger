import { isAdmin, isPro, isFree } from './roles';
import type { UserRole } from '@prisma/client';

describe('isAdmin', () => {
  it('should return true for ADMIN role', () => {
    expect(isAdmin('ADMIN' as UserRole)).toBe(true);
  });

  it('should return false for PRO role', () => {
    expect(isAdmin('PRO' as UserRole)).toBe(false);
  });

  it('should return false for FREE role', () => {
    expect(isAdmin('FREE' as UserRole)).toBe(false);
  });
});

describe('isPro', () => {
  it('should return true for PRO role', () => {
    expect(isPro('PRO' as UserRole)).toBe(true);
  });

  it('should return true for ADMIN role (admins have pro access)', () => {
    expect(isPro('ADMIN' as UserRole)).toBe(true);
  });

  it('should return false for FREE role', () => {
    expect(isPro('FREE' as UserRole)).toBe(false);
  });
});

describe('isFree', () => {
  it('should return true for FREE role', () => {
    expect(isFree('FREE' as UserRole)).toBe(true);
  });

  it('should return false for PRO role', () => {
    expect(isFree('PRO' as UserRole)).toBe(false);
  });

  it('should return false for ADMIN role', () => {
    expect(isFree('ADMIN' as UserRole)).toBe(false);
  });
});
