import express, { type Request } from 'express';
import { prisma } from '../lib/prisma';
import { clearSessionCookie, type SessionUser } from './session';
import { sendBadRequest, sendUnauthorized, sendInternalError } from '../lib/api-response';
import { logError } from '../lib/logger';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      sessionUser?: SessionUser;
    }
  }
}

const router = express.Router();

/**
 * DELETE /auth/delete-account
 * Deletes the current user's account and all associated data
 * Requires authenticated session
 */
router.delete('/delete-account', async (req: Request, res) => {
  try {
    const sessionUser = req.sessionUser;

    // Verify user is authenticated
    if (!sessionUser?.uid) {
      return sendUnauthorized(res, 'No active session');
    }

    const userId = sessionUser.uid;

    console.log(`[DeleteAccount] Deleting account and data for user: ${userId}`);

    // Delete all user data in the correct order based on foreign key relationships
    // This will cascade delete based on the Prisma schema definitions

    // 1. Delete rides (these have bikeId references)
    await prisma.ride.deleteMany({
      where: { userId },
    });
    console.log(`[DeleteAccount] Deleted rides for user: ${userId}`);

    // 2. Delete components (these reference userId with onDelete: Cascade, but do it explicitly)
    await prisma.component.deleteMany({
      where: { userId },
    });
    console.log(`[DeleteAccount] Deleted components for user: ${userId}`);

    // 3. Delete bikes
    await prisma.bike.deleteMany({
      where: { userId },
    });
    console.log(`[DeleteAccount] Deleted bikes for user: ${userId}`);

    // 4. Delete OAuth tokens
    await prisma.oauthToken.deleteMany({
      where: { userId },
    });
    console.log(`[DeleteAccount] Deleted OAuth tokens for user: ${userId}`);

    // 5. Delete user accounts (these reference userId with onDelete: Cascade, but do it explicitly)
    await prisma.userAccount.deleteMany({
      where: { userId },
    });
    console.log(`[DeleteAccount] Deleted user accounts for user: ${userId}`);

    // 6. Finally, delete the user
    const deletedUser = await prisma.user.delete({
      where: { id: userId },
    });
    console.log(`[DeleteAccount] Successfully deleted user: ${deletedUser.email}`);

    // Clear the session cookie
    clearSessionCookie(res);

    res.status(200).json({
      ok: true,
      message: 'Account successfully deleted'
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError('DeleteAccount', error);

    // Check if it's a "not found" error
    if (errorMessage.includes('An operation failed because it depends on one or more records')) {
      return sendBadRequest(res, 'Failed to delete account: Some data could not be removed');
    }

    return sendInternalError(res, 'An error occurred while deleting your account. Please try again.');
  }
});

export default router;
