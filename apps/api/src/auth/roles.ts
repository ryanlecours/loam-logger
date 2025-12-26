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
 * Check if user is on WAITLIST (not yet activated)
 */
export function isWaitlist(role: UserRole): boolean {
  return role === 'WAITLIST';
}

/**
 * Check if user has been activated (not WAITLIST)
 */
export function isActivated(role: UserRole): boolean {
  return role !== 'WAITLIST';
}
