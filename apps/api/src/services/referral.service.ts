import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { sendEmailWithAudit } from './email.service';
import { getReferralSuccessEmailHtml, getReferralSuccessEmailSubject, REFERRAL_SUCCESS_TEMPLATE_VERSION } from '../templates/emails/referral-success';

/**
 * Generate an 8-character hex referral code.
 * With ~4 billion possible values, collisions are effectively impossible.
 * The DB unique constraint on referralCode is the real safety net.
 */
export function generateReferralCode(): string {
  return crypto.randomBytes(4).toString('hex');
}

/**
 * Generate a referral code and retry user creation if the code collides
 * with an existing one (P2002 on referralCode unique constraint).
 * Returns the code that was successfully used.
 */
export async function createUserWithReferralCode<T>(
  createFn: (code: string) => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = generateReferralCode();
    try {
      return await createFn(code);
    } catch (err) {
      const isReferralCodeCollision =
        err instanceof Error &&
        'code' in err &&
        (err as { code: string }).code === 'P2002' &&
        'meta' in err &&
        ((err as { meta?: { target?: string[] } }).meta?.target ?? []).includes('referralCode');

      if (!isReferralCodeCollision || attempt === maxAttempts - 1) throw err;
      // Retry with a new code
    }
  }
  // Unreachable, but TypeScript needs it
  throw new Error('Failed to generate unique referral code');
}

/**
 * Look up the referrer for a given code. Returns the referrer's user ID,
 * or null if the code is invalid.
 *
 * Called BEFORE user creation so the referral can be created atomically
 * with the new user record.
 *
 * Note: self-referral via a second account is not prevented here — that's
 * a policy/abuse concern, not a data integrity issue.
 */
export async function resolveReferrer(code: string): Promise<string | null> {
  const referrer = await prisma.user.findUnique({
    where: { referralCode: code },
    select: { id: true },
  });

  return referrer?.id ?? null;
}

/**
 * Minimum number of rides the referred user must have logged before
 * the referral completes and the referrer gets upgraded.
 */
const MIN_RIDES_FOR_REFERRAL = 1;

/**
 * Attempt to complete a referral for a referred user. Called from onboarding
 * and after ride creation. The referral only completes when:
 * 1. The referred user has logged at least MIN_RIDES_FOR_REFERRAL rides
 * 2. The referred user's signup IP differs from the referrer's (abuse check)
 *
 * Safe to call multiple times — idempotent via atomic PENDING → COMPLETED claim.
 */
export async function completeReferral(referredUserId: string): Promise<void> {
  const referral = await prisma.referral.findUnique({
    where: { referredUserId },
    include: {
      referrer: { select: { id: true, email: true, name: true, subscriptionTier: true, isFoundingRider: true, signupIp: true } },
      referred: { select: { name: true, signupIp: true } },
    },
  });

  if (!referral || referral.status === 'COMPLETED') return;

  // Abuse check: same signup IP suggests self-referral via second account
  if (
    referral.referrer.signupIp &&
    referral.referred.signupIp &&
    referral.referrer.signupIp === referral.referred.signupIp
  ) {
    logger.warn(
      { referralId: referral.id, referrerId: referral.referrer.id, referredUserId, ip: referral.referred.signupIp },
      'Referral blocked: same signup IP as referrer (possible self-referral)'
    );
    return;
  }

  // Ride gate: referred user must have logged at least 1 ride
  const rideCount = await prisma.ride.count({
    where: { userId: referredUserId },
  });

  if (rideCount < MIN_RIDES_FOR_REFERRAL) return; // not ready yet — will be retried after ride creation

  // Interactive transaction: claim the referral, then conditionally upgrade.
  // Returns null if the claim was lost to a concurrent call.
  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.referral.updateMany({
      where: { id: referral.id, status: 'PENDING' },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    if (claimed.count === 0) return null; // lost the race

    // Re-read referrer state inside the transaction to avoid stale data
    const referrer = await tx.user.findUniqueOrThrow({
      where: { id: referral.referrer.id },
      select: { subscriptionTier: true, isFoundingRider: true },
    });

    if (referrer.subscriptionTier === 'FREE_LIGHT' && !referrer.isFoundingRider) {
      await tx.user.update({
        where: { id: referral.referrer.id },
        data: { subscriptionTier: 'FREE_FULL' },
      });
      return { upgraded: true };
    }

    return { upgraded: false };
  });

  if (!result) return; // concurrent call already completed this referral

  if (result.upgraded) {
    logger.info({ referrerId: referral.referrer.id }, 'Referrer upgraded to FREE_FULL via referral');
  }

  logger.info({ referralId: referral.id, referredUserId }, 'Referral completed');

  // Send referral success email to the referrer (non-blocking — bypasses unsubscribe)
  if (result.upgraded) {
    try {
      const referrerFirstName = referral.referrer.name?.split(' ')[0] || undefined;
      const referredFirstName = referral.referred.name?.split(' ')[0] || undefined;

      await sendEmailWithAudit({
        to: referral.referrer.email,
        subject: getReferralSuccessEmailSubject(referredFirstName),
        html: await getReferralSuccessEmailHtml({
          name: referrerFirstName,
          referredName: referredFirstName,
        }),
        userId: referral.referrer.id,
        emailType: 'referral_success',
        triggerSource: 'user_action',
        templateVersion: REFERRAL_SUCCESS_TEMPLATE_VERSION,
        bypassUnsubscribe: true,
      });
    } catch (emailErr) {
      logger.error(
        { error: emailErr instanceof Error ? emailErr.message : String(emailErr), referrerId: referral.referrer.id },
        'Failed to send referral success email'
      );
    }
  }
}

/**
 * Get referral stats for a user.
 */
export async function getReferralStats(userId: string) {
  let user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { referralCode: true },
  });

  // Backfill referral code for pre-migration users who don't have one.
  // Uses updateMany WHERE referralCode IS NULL to avoid overwriting a concurrent write,
  // and retries on unique constraint violation (code collision with another user).
  if (!user.referralCode) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = generateReferralCode();
      try {
        const result = await prisma.user.updateMany({
          where: { id: userId, referralCode: null },
          data: { referralCode: code },
        });

        if (result.count === 0) {
          // Another request already set it — re-read
          user = await prisma.user.findUniqueOrThrow({
            where: { id: userId },
            select: { referralCode: true },
          });
          break;
        }

        user = { referralCode: code };
        break;
      } catch (err) {
        // P2002 = unique constraint violation (code collided with another user's code)
        const isUniqueViolation = err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2002';
        if (!isUniqueViolation || attempt === 2) throw err;
        // Retry with a new code
      }
    }
  }

  const [pendingCount, completedCount] = await Promise.all([
    prisma.referral.count({ where: { referrerUserId: userId, status: 'PENDING' } }),
    prisma.referral.count({ where: { referrerUserId: userId, status: 'COMPLETED' } }),
  ]);

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  return {
    referralCode: user.referralCode!,
    referralLink: `${frontendUrl}/signup?ref=${user.referralCode}`,
    pendingCount,
    completedCount,
  };
}
