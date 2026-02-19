import { sendReactEmailWithAudit } from './email.service';
import PasswordAddedEmail, {
  getPasswordAddedEmailSubject,
  PASSWORD_ADDED_TEMPLATE_VERSION,
} from '../templates/emails/password-added';
import PasswordChangedEmail, {
  getPasswordChangedEmailSubject,
  PASSWORD_CHANGED_TEMPLATE_VERSION,
} from '../templates/emails/password-changed';
import { prisma } from '../lib/prisma';
import { generateUnsubscribeUrl } from '../lib/unsubscribe-token';
import { logger } from '../lib/logger';

/**
 * Send email notification when a password is added to an account.
 * This is a security notification - it bypasses the emailUnsubscribed flag.
 */
export async function sendPasswordAddedNotification(userId: string): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });

    if (!user) {
      logger.warn({ userId }, 'Cannot send password added notification: user not found');
      return;
    }

    const firstName = user.name?.split(' ')[0];
    const unsubscribeUrl = generateUnsubscribeUrl(user.id);

    await sendReactEmailWithAudit({
      to: user.email,
      subject: getPasswordAddedEmailSubject(),
      reactElement: (
        <PasswordAddedEmail
          recipientFirstName={firstName}
          email={user.email}
          unsubscribeUrl={unsubscribeUrl}
        />
      ),
      userId: user.id,
      emailType: 'password_added',
      triggerSource: 'user_action',
      templateVersion: PASSWORD_ADDED_TEMPLATE_VERSION,
      bypassUnsubscribe: true,
    });

    logger.info({ userId, email: user.email }, 'Password added notification sent');
  } catch (error) {
    logger.error({ userId, error }, 'Failed to send password added notification');
    // Don't throw - email failure shouldn't block the password operation
  }
}

/**
 * Send email notification when a password is changed.
 * This is a security notification - it bypasses the emailUnsubscribed flag.
 */
export async function sendPasswordChangedNotification(userId: string): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });

    if (!user) {
      logger.warn({ userId }, 'Cannot send password changed notification: user not found');
      return;
    }

    const firstName = user.name?.split(' ')[0];
    const unsubscribeUrl = generateUnsubscribeUrl(user.id);

    await sendReactEmailWithAudit({
      to: user.email,
      subject: getPasswordChangedEmailSubject(),
      reactElement: (
        <PasswordChangedEmail
          recipientFirstName={firstName}
          email={user.email}
          unsubscribeUrl={unsubscribeUrl}
        />
      ),
      userId: user.id,
      emailType: 'password_changed',
      triggerSource: 'user_action',
      templateVersion: PASSWORD_CHANGED_TEMPLATE_VERSION,
      bypassUnsubscribe: true,
    });

    logger.info({ userId, email: user.email }, 'Password changed notification sent');
  } catch (error) {
    logger.error({ userId, error }, 'Failed to send password changed notification');
    // Don't throw - email failure shouldn't block the password operation
  }
}
