import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';

// Server-side state for mobile refresh tokens. The tokens themselves are
// still stateless JWTs, but each one names a MobileSession row (sid) and a
// one-time rotation id (jti). That pairing is what makes the long sliding
// refresh window defensible: a leaked token stops being an invisible
// year-long bearer credential, because replaying a spent jti revokes the
// session on the spot, and any individual device can be revoked without
// bumping the user's global sessionTokenVersion.

/** Sliding session lifetime; pushed forward on every successful refresh. */
export const MOBILE_REFRESH_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * How long the previous jti stays honored after a rotation. A device that
 * never received the rotation response (trail dead zone, timeout) retries
 * with the token it still holds — the one just rotated away from. Reading
 * that retry as theft would revoke the session and recreate the exact
 * mid-ride logout this work exists to kill, so a short grace window
 * distinguishes "lost response" from "replayed weeks later."
 */
export const REFRESH_ROTATION_GRACE_MS = 60_000;

export interface NewMobileSession {
  sid: string;
  jti: string;
}

/** One row per device sign-in; also the upgrade path for legacy tokens. */
export async function createMobileSession(userId: string): Promise<NewMobileSession> {
  const jti = randomUUID();
  const now = new Date();
  const session = await prisma.mobileSession.create({
    data: {
      userId,
      currentJti: jti,
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + MOBILE_REFRESH_TTL_MS),
    },
  });
  return { sid: session.id, jti };
}

export type RotationResult =
  | { ok: true; jti: string }
  | { ok: false; reason: 'not-found' | 'revoked' | 'expired' | 'reuse-detected' };

/**
 * Validate a presented refresh jti against its session and, when valid,
 * rotate to a new jti and slide the expiry forward.
 *
 * Concurrency: refreshes for one session can race (a foreground trigger
 * and a background timer double-firing, or a retry after a slow but
 * successful response). A read-validate-write here would let both racers
 * pass validation and the loser's freshly-minted jti would never be
 * persisted — so the loser's device presents an orphaned jti next time and
 * gets revoked as a "thief," recreating the spurious logout this table
 * exists to prevent. Instead: an atomic conditional write claims the
 * rotation, and every racer that loses the claim is handed the SAME
 * current jti the winner produced. Rotation is idempotent per presented
 * token, so the device ends up holding a live token no matter which
 * response arrives last.
 */
export async function rotateMobileSession(
  sid: string,
  presentedJti: string,
): Promise<RotationResult> {
  const now = new Date();
  const jti = randomUUID();

  // Atomic fast path: rotate iff the presented jti is still current.
  const rotated = await prisma.mobileSession.updateMany({
    where: { id: sid, currentJti: presentedJti, revokedAt: null, expiresAt: { gt: now } },
    data: {
      currentJti: jti,
      previousJti: presentedJti,
      rotatedAt: now,
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + MOBILE_REFRESH_TTL_MS),
    },
  });
  if (rotated.count === 1) return { ok: true, jti };

  // The conditional write matched nothing; read to find out why.
  const session = await prisma.mobileSession.findUnique({ where: { id: sid } });
  if (!session) return { ok: false, reason: 'not-found' };
  if (session.revokedAt) return { ok: false, reason: 'revoked' };
  if (session.expiresAt < now) return { ok: false, reason: 'expired' };

  const lostRaceInGrace =
    presentedJti === session.previousJti &&
    now.getTime() - session.rotatedAt.getTime() < REFRESH_ROTATION_GRACE_MS;
  // Defensive only: nothing ever writes an old jti back to currentJti, so
  // a failed conditional write with the presented jti still current should
  // be unreachable — but if it happens, the caller holds a valid token and
  // must not be punished for our race handling.
  const stillCurrent = presentedJti === session.currentJti;

  if (lostRaceInGrace || stillCurrent) {
    // Do NOT rotate again — that would clobber the winner's jti and shift
    // the orphaned-token problem one rotation down. Re-issue the current
    // jti and slide the expiry as any successful refresh does.
    await prisma.mobileSession.updateMany({
      where: { id: sid, revokedAt: null },
      data: { lastUsedAt: now, expiresAt: new Date(now.getTime() + MOBILE_REFRESH_TTL_MS) },
    });
    return { ok: true, jti: session.currentJti };
  }

  // A spent jti outside the grace window means two parties hold tokens
  // from this session's chain — the legitimate device and whoever replayed
  // this one. There is no way to tell which caller is which, so kill the
  // session; the legitimate device re-authenticates once, the stolen chain
  // dies with it.
  await prisma.mobileSession.updateMany({
    where: { id: sid, revokedAt: null },
    data: { revokedAt: now },
  });
  return { ok: false, reason: 'reuse-detected' };
}

/**
 * Revoke one session. Scoped to the owning user so a forged sid in an
 * otherwise-valid token cannot revoke someone else's session. Idempotent:
 * revoking an already-revoked or missing session is a no-op, because logout
 * must never fail retroactively.
 */
export async function revokeMobileSession(sid: string, userId: string): Promise<void> {
  await prisma.mobileSession.updateMany({
    where: { id: sid, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
