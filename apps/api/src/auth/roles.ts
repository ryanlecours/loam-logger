import type { UserRole } from '@prisma/client';

/**
 * Check if user has ADMIN role
 */
export function isAdmin(role: UserRole): boolean {
  return role === 'ADMIN';
}

/**
 * Check if user has PRO access (PRO or ADMIN)
 */
export function isPro(role: UserRole): boolean {
  return role === 'PRO' || role === 'ADMIN';
}

/**
 * Check if user is on FREE tier
 */
export function isFree(role: UserRole): boolean {
  return role === 'FREE';
}

/**
 * Check if user has at least FREE tier access (FREE, PRO, or ADMIN).
 * Note: Founding riders have PRO role, so they're covered by the PRO check.
 */
export function hasFreeTierAccess(role: UserRole): boolean {
  return role === 'FREE' || role === 'PRO' || role === 'ADMIN';
}
