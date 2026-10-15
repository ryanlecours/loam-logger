import express, { type Request } from 'express';
import { clearSessionCookie, type SessionUser } from './session';
import { sendBadRequest, sendUnauthorized, sendInternalError, sendError } from '../lib/api-response';
import { logError } from '../lib/logger';
import { deleteUserAccount, BillingCancellationError } from '../services/account-deletion.service';

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

    await deleteUserAccount(sessionUser.uid);

    // Clear the session cookie
    clearSessionCookie(res);

    res.status(200).json({
      ok: true,
      message: 'Account successfully deleted'
    });
  } catch (error) {
    if (error instanceof BillingCancellationError) {
      logError('DeleteAccount:Stripe', error.cause);
      return sendError(
        res,
        503,
        "We couldn't cancel your Loam Logger Pro subscription, so your account has not been deleted. Please try again in a few minutes.",
        'BILLING_CANCELLATION_FAILED'
      );
    }

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
