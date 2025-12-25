import { Resend } from 'resend';

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

const FROM_EMAIL = process.env.EMAIL_FROM || 'Loam Logger <noreply@loamlogger.com>';

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
    to,
    subject,
    html,
    text: text || stripHtml(html),
  });

  if (error) {
    console.error('[Email] Failed to send:', error);
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
