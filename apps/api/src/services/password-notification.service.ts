import { sendReactEmailWithAudit } from './email.service';
import {
  buildPasswordAddedEmailElement,
  getPasswordAddedEmailSubject,
  PASSWORD_ADDED_TEMPLATE_VERSION,
} from '../templates/emails/password-added';
import {
  buildPasswordChangedEmailElement,
  getPasswordChangedEmailSubject,
  PASSWORD_CHANGED_TEMPLATE_VERSION,
} from '../templates/emails/password-changed';
import { logger } from '../lib/logger';

export type PasswordNotificationUser = {
  id: string;
  email: string;
  name?: string | null;
};

/**
 * Send email notification when a password is added to an account.
 * This is a security notification - it bypasses the emailUnsubscribed flag.
 */
export async function sendPasswordAddedNotification(user: PasswordNotificationUser): Promise<void> {
  try {
    const firstName = user.name?.split(' ')[0];

    await sendReactEmailWithAudit({
      to: user.email,
      subject: getPasswordAddedEmailSubject(),
      reactElement: buildPasswordAddedEmailElement({
        recipientFirstName: firstName,
        email: user.email,
      }),
      userId: user.id,
      emailType: 'password_added',
      triggerSource: 'user_action',
      templateVersion: PASSWORD_ADDED_TEMPLATE_VERSION,
      bypassUnsubscribe: true,
    });

    logger.info({ userId: user.id, email: user.email }, 'Password added notification sent');
  } catch (error) {
    logger.error({ userId: user.id, error }, 'Failed to send password added notification');
    // Don't throw - email failure shouldn't block the password operation
  }
}

/**
 * Send email notification when a password is changed.
 * This is a security notification - it bypasses the emailUnsubscribed flag.
 */
export async function sendPasswordChangedNotification(user: PasswordNotificationUser): Promise<void> {
  try {
    const firstName = user.name?.split(' ')[0];

    await sendReactEmailWithAudit({
      to: user.email,
      subject: getPasswordChangedEmailSubject(),
      reactElement: buildPasswordChangedEmailElement({
        recipientFirstName: firstName,
        email: user.email,
      }),
      userId: user.id,
      emailType: 'password_changed',
      triggerSource: 'user_action',
      templateVersion: PASSWORD_CHANGED_TEMPLATE_VERSION,
      bypassUnsubscribe: true,
    });

    logger.info({ userId: user.id, email: user.email }, 'Password changed notification sent');
  } catch (error) {
    logger.error({ userId: user.id, error }, 'Failed to send password changed notification');
    // Don't throw - email failure shouldn't block the password operation
  }
}
