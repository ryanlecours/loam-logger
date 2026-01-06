import { Resend } from 'resend';
import { logError } from '../lib/logger';
import { prisma } from '../lib/prisma';
import type { EmailType, TriggerSource, EmailStatus } from '@prisma/client';

let resend: Resend | null = null;

function getResendClient(): Resend {
  if (!resend) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('RESEND_API_KEY environment variable is required');
    }
    resend = new Resend(apiKey);
  }
  return resend;
}

const FROM_EMAIL = 'Ryan LeCours <ryan.lecours@onboarding.loamlogger.app>';
const REPLY_TO_EMAIL = 'ryan.lecours@loamlogger.app';

export type SendEmailParams = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

/**
 * Send an email using Resend.
 */
export async function sendEmail({ to, subject, html, text }: SendEmailParams): Promise<string> {
  const client = getResendClient();

  const { data, error } = await client.emails.send({
    from: FROM_EMAIL,
    reply_to: REPLY_TO_EMAIL,
    to,
    subject,
    html,
    text: text || stripHtml(html),
  });

  if (error) {
    logError('Email send', error);
    throw new Error(`Failed to send email: ${error.message}`);
  }

  console.log(`[Email] Sent to ${to}: ${subject} (id: ${data?.id})`);
  return data?.id || '';
}

/**
 * Simple HTML to plain text conversion for fallback.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export type SendEmailWithAuditParams = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  userId: string;
  emailType: EmailType;
  triggerSource: TriggerSource;
  templateVersion?: string;
};

export type SendEmailWithAuditResult = {
  messageId: string;
  status: EmailStatus;
};

/**
 * Send email with audit logging to EmailSend table.
 * Checks emailUnsubscribed flag and records suppressed sends.
 */
export async function sendEmailWithAudit({
  to,
  subject,
  html,
  text,
  userId,
  emailType,
  triggerSource,
  templateVersion,
}: SendEmailWithAuditParams): Promise<SendEmailWithAuditResult> {
  // Check if user is unsubscribed
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailUnsubscribed: true },
  });

  if (user?.emailUnsubscribed) {
    // Record suppressed send
    await prisma.emailSend.create({
      data: {
        userId,
        toEmail: to,
        emailType,
        triggerSource,
        templateVersion,
        status: 'suppressed',
        failureReason: 'User unsubscribed',
      },
    });
    console.log(`[Email] Suppressed email to ${to} (unsubscribed)`);
    return { messageId: '', status: 'suppressed' };
  }

  try {
    const messageId = await sendEmail({ to, subject, html, text });

    // Record successful send
    await prisma.emailSend.create({
      data: {
        userId,
        toEmail: to,
        emailType,
        triggerSource,
        templateVersion,
        status: 'sent',
        providerMessageId: messageId,
      },
    });

    return { messageId, status: 'sent' };
  } catch (error) {
    // Record failed send
    await prisma.emailSend.create({
      data: {
        userId,
        toEmail: to,
        emailType,
        triggerSource,
        templateVersion,
        status: 'failed',
        failureReason: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    throw error;
  }
}
