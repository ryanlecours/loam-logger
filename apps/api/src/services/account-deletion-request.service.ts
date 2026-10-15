import { render } from '@react-email/render';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { sendEmail } from './email.service';
import { deleteUserAccount } from './account-deletion.service';
import {
  ACCOUNT_DELETION_TTL_MINUTES,
  generateAccountDeletionToken,
  verifyAccountDeletionToken,
} from '../lib/account-deletion-token';
import {
  buildAccountDeletionEmailElement,
  getAccountDeletionEmailSubject,
} from '../templates/emails/account-deletion';
import { FRONTEND_URL } from '../config/env';

export type AccountDeletionRequestUser = {
  id: string;
  email: string;
  name?: string | null;
};

/**
 * The emailed link lands on a web page with a confirm button rather than
 * deleting on GET: mail scanners and link previewers fetch links on arrival,
 * and a GET that deleted would let them delete accounts nobody confirmed.
 */
export function buildAccountDeletionConfirmUrl(rawToken: string): string {
  const url = new URL('/delete-account/confirm', FRONTEND_URL);
  url.searchParams.set('token', rawToken);
  return url.toString();
}

/**
 * Email a link that confirms deleting this account.
 *
 * Sent with plain sendEmail, not the audited sender: the audit log's
 * EmailType enum has no value for this, adding one needs a migration, and a
 * confirmed request deletes the audit rows with the user anyway.
 */
export async function sendAccountDeletionEmail(user: AccountDeletionRequestUser): Promise<void> {
  const rawToken = generateAccountDeletionToken(user.id, user.email);
  const html = await render(
    buildAccountDeletionEmailElement({
      recipientFirstName: user.name?.split(' ')[0],
      email: user.email,
      confirmUrl: buildAccountDeletionConfirmUrl(rawToken),
      expiresInMinutes: ACCOUNT_DELETION_TTL_MINUTES,
    }),
  );

  await sendEmail({ to: user.email, subject: getAccountDeletionEmailSubject(), html });
  logger.info({ userId: user.id }, '[AccountDeletion] Confirmation email sent');
}

export type ConfirmAccountDeletionResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'expired' | 'invalid' };

/**
 * Redeem an emailed deletion token and delete the account it names.
 *
 * The token must still match the account's current email: a link sent before
 * an email change goes to an address that may no longer belong to the rider.
 * Errors from the deletion itself (such as a Stripe cancellation failure)
 * propagate so the route can answer the way DELETE /auth/delete-account does.
 */
export async function confirmAccountDeletion(rawToken: string): Promise<ConfirmAccountDeletionResult> {
  const verified = verifyAccountDeletionToken(rawToken);
  if (!verified.ok) {
    return verified;
  }

  const user = await prisma.user.findUnique({
    where: { id: verified.userId },
    select: { id: true, email: true },
  });
  if (!user || user.email !== verified.email) {
    return { ok: false, reason: 'invalid' };
  }

  await deleteUserAccount(user.id);
  return { ok: true, userId: user.id };
}
