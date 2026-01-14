import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { hashPassword } from '../auth/password.utils';
import { sendEmail } from './email.service';
import { getActivationEmailSubject, getActivationEmailHtml } from '../templates/emails';
import { generateUnsubscribeToken } from '../lib/unsubscribe-token';
import { PASSWORD_REQUIREMENTS } from '@loam/shared';

const API_URL = process.env.API_URL || 'http://localhost:4000';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Word list for generating memorable temporary passwords
const WORD_LIST = [
  'Peak', 'Trail', 'Ride', 'Loam', 'Flow', 'Grip', 'Send', 'Shred', 'Drop', 'Jump',
  'Climb', 'Dirt', 'Rock', 'Root', 'Berm', 'Line', 'Roost', 'Rip', 'Huck', 'Gnar',
];

// Special characters from shared requirements
const SPECIAL_CHARS = PASSWORD_REQUIREMENTS.specialChars.split('');

/**
 * Generate a secure temporary password that satisfies validation rules.
 * Format: Word!Word#1234
 * - Contains uppercase (from capitalized words)
 * - Contains lowercase (from word tails)
 * - Contains numbers (4 digits)
 * - Contains special characters (from PASSWORD_REQUIREMENTS.specialChars)
 * - At least PASSWORD_REQUIREMENTS.minLength characters
 */
export function generateTempPassword(): string {
  const word1 = WORD_LIST[crypto.randomInt(WORD_LIST.length)];
  const word2 = WORD_LIST[crypto.randomInt(WORD_LIST.length)];
  const special1 = SPECIAL_CHARS[crypto.randomInt(SPECIAL_CHARS.length)];
  const special2 = SPECIAL_CHARS[crypto.randomInt(SPECIAL_CHARS.length)];
  const digits = crypto.randomInt(1000, 9999).toString();

  // Format: Peak!Trail#4827
  return `${word1}${special1}${word2}${special2}${digits}`;
}

export type ActivateUserParams = {
  userId: string;
  adminUserId: string;
};

export type ActivateUserResult = {
  success: boolean;
  userId: string;
  email: string;
  emailQueued: boolean;
  /**
   * SECURITY NOTE: tempPassword is only returned when email queueing fails.
   * This is an intentional tradeoff to prevent users from being stuck without access.
   *
   * Callers MUST:
   * - Never log API responses containing this field
   * - Display it once to admin and not persist it
   * - Ensure HTTPS is used for all admin API calls
   *
   * The admin should securely communicate this to the user (e.g., phone call, secure message).
   */
  tempPassword?: string;
};

/**
 * Activate a WAITLIST user by:
 * 1. Verifying they're in WAITLIST state
 * 2. Generating a temporary password
 * 3. Updating their role to PRO (founding riders) or FREE (regular users)
 * 4. Queuing activation email
 * 5. Scheduling welcome email series
 *
 * Security: Temp password is only returned to admin if email queueing fails.
 * The password is cleared from memory after use to minimize exposure in stack traces.
 */
export async function activateWaitlistUser({
  userId,
  adminUserId,
}: ActivateUserParams): Promise<ActivateUserResult> {
  // 1. Verify user exists and is in WAITLIST state
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, isFoundingRider: true },
  });

  if (!user) {
    throw new Error('User not found');
  }

  if (user.role !== 'WAITLIST') {
    throw new Error(`User is already activated (current role: ${user.role})`);
  }

  // 2. Generate temporary password and hash it
  // Store in mutable variable so we can clear it after use
  let tempPassword: string | null = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  // 3. Update user record
  // Note: We update the user first, then queue emails. If email queueing fails,
  // the user is still activated but we return the temp password for manual sharing.
  // This is preferable to leaving a user in WAITLIST state indefinitely.
  // Founding riders get lifetime PRO access; regular users get FREE tier.
  await prisma.user.update({
    where: { id: userId },
    data: {
      role: user.isFoundingRider ? 'PRO' : 'FREE',
      passwordHash,
      mustChangePassword: true,
      activatedAt: new Date(),
      activatedBy: adminUserId,
    },
  });

  // 4. Send activation email synchronously
  // If this fails, user is activated but won't receive email - return temp password for manual sharing
  let emailSent = false;
  let returnPassword: string | undefined;

  try {
    const unsubscribeToken = generateUnsubscribeToken(user.id);
    const unsubscribeUrl = `${API_URL}/api/email/unsubscribe?token=${unsubscribeToken}`;

    await sendEmail({
      to: user.email,
      subject: getActivationEmailSubject(),
      html: await getActivationEmailHtml({
        name: user.name || undefined,
        email: user.email,
        tempPassword,
        loginUrl: `${FRONTEND_URL}/login`,
        unsubscribeUrl,
      }),
    });

    emailSent = true;
    console.log(`[Activation] User ${user.email} activated by admin ${adminUserId}`);
  } catch (emailErr) {
    // CRITICAL: User is activated but email failed - preserve temp password for admin
    // Log the error for debugging but don't expose the password
    console.error(
      `[Activation] CRITICAL: User ${user.email} (${userId}) activated but email sending failed:`,
      emailErr instanceof Error ? emailErr.message : 'Unknown error'
    );
    returnPassword = tempPassword;
  }

  // Clear the temp password from memory now that we're done with it
  tempPassword = null;

  return {
    success: true,
    userId: user.id,
    email: user.email,
    emailQueued: emailSent,
    ...(returnPassword ? { tempPassword: returnPassword } : {}),
  };
}
