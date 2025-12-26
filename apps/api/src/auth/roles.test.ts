import { isAdmin, isPro, isFree, isWaitlist, isActivated } from './roles';
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

  it('should return false for WAITLIST role', () => {
    expect(isAdmin('WAITLIST' as UserRole)).toBe(false);
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

  it('should return false for WAITLIST role', () => {
    expect(isPro('WAITLIST' as UserRole)).toBe(false);
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

  it('should return false for WAITLIST role', () => {
    expect(isFree('WAITLIST' as UserRole)).toBe(false);
  });
});

describe('isWaitlist', () => {
  it('should return true for WAITLIST role', () => {
    expect(isWaitlist('WAITLIST' as UserRole)).toBe(true);
  });

  it('should return false for FREE role', () => {
    expect(isWaitlist('FREE' as UserRole)).toBe(false);
  });

  it('should return false for PRO role', () => {
    expect(isWaitlist('PRO' as UserRole)).toBe(false);
  });

  it('should return false for ADMIN role', () => {
    expect(isWaitlist('ADMIN' as UserRole)).toBe(false);
  });
});

describe('isActivated', () => {
  it('should return false for WAITLIST role (not activated)', () => {
    expect(isActivated('WAITLIST' as UserRole)).toBe(false);
  });

  it('should return true for FREE role (activated)', () => {
    expect(isActivated('FREE' as UserRole)).toBe(true);
  });

  it('should return true for PRO role (activated)', () => {
    expect(isActivated('PRO' as UserRole)).toBe(true);
  });

  it('should return true for ADMIN role (activated)', () => {
    expect(isActivated('ADMIN' as UserRole)).toBe(true);
  });
});
