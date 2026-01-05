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
 * Check if user is a FOUNDING_RIDERS (early waitlist users with lifetime access)
 */
export function isFoundingRider(role: UserRole): boolean {
  return role === 'FOUNDING_RIDERS';
}

/**
 * Check if user has at least FREE tier access (FOUNDING_RIDERS, FREE, PRO, or ADMIN)
 */
export function hasFreeTierAccess(role: UserRole): boolean {
  return role === 'FOUNDING_RIDERS' || role === 'FREE' || role === 'PRO' || role === 'ADMIN';
}

/**
 * Check if user has been activated (not WAITLIST)
 */
export function isActivated(role: UserRole): boolean {
  return role !== 'WAITLIST';
}
