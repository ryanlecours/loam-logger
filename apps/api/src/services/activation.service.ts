import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { hashPassword } from '../auth/password.utils';
import { getEmailQueue, scheduleWelcomeSeries } from '../lib/queue';

// Word list for generating memorable temporary passwords
const WORD_LIST = [
  'Peak', 'Trail', 'Ride', 'Loam', 'Flow', 'Grip', 'Send', 'Shred', 'Drop', 'Jump',
  'Climb', 'Dirt', 'Rock', 'Root', 'Berm', 'Line', 'Roost', 'Rip', 'Huck', 'Gnar',
];

// Special characters for password validation compliance
const SPECIAL_CHARS = ['!', '@', '#', '$', '%', '^', '&', '*'];

/**
 * Generate a secure temporary password that satisfies validation rules.
 * Format: Word!Word#1234
 * - Contains uppercase (from capitalized words)
 * - Contains lowercase (from word tails)
 * - Contains numbers (4 digits)
 * - Contains special characters (! and #)
 * - At least 8 characters
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
};

/**
 * Activate a WAITLIST user by:
 * 1. Verifying they're in WAITLIST state
 * 2. Generating a temporary password
 * 3. Updating their role to FREE
 * 4. Queuing activation email
 * 5. Scheduling welcome email series
 */
export async function activateWaitlistUser({
  userId,
  adminUserId,
}: ActivateUserParams): Promise<ActivateUserResult> {
  // 1. Verify user exists and is in WAITLIST state
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true },
  });

  if (!user) {
    throw new Error('User not found');
  }

  if (user.role !== 'WAITLIST') {
    throw new Error(`User is already activated (current role: ${user.role})`);
  }

  // 2. Generate temporary password
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  // 3. Update user record
  await prisma.user.update({
    where: { id: userId },
    data: {
      role: 'FREE',
      passwordHash,
      mustChangePassword: true,
      activatedAt: new Date(),
      activatedBy: adminUserId,
    },
  });

  // 4. Queue activation email
  const emailQueue = getEmailQueue();
  await emailQueue.add(
    'activation',
    {
      userId: user.id,
      email: user.email,
      name: user.name || undefined,
      tempPassword,
    },
    {
      jobId: `activation-${userId}`,
    }
  );

  // 5. Schedule welcome series
  await scheduleWelcomeSeries(user.id, user.email, user.name || undefined);

  console.log(`[Activation] User ${user.email} activated by admin ${adminUserId}`);

  return {
    success: true,
    userId: user.id,
    email: user.email,
  };
}
