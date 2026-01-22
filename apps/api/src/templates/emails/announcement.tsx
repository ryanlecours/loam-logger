import * as React from "react";
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
  Hr,
} from "@react-email/components";
import { render } from "@react-email/render";
import { sanitizeUserInput, escapeHtml } from "../../lib/html";
import type { TemplateConfig } from "./types";

export const ANNOUNCEMENT_TEMPLATE_VERSION = "2.1.0";

export type AnnouncementEmailProps = {
  recipientFirstName?: string;
  subject?: string;
  previewText?: string;
  messageContent?: React.ReactNode;
  unsubscribeUrl?: string;
};

const TOKENS = {
  // Light mode (default)
  bg: "#FBFAF2",
  card: "#F4F7F5",
  border: "#D4DDD9",
  text: "#121816",
  muted: "#5A6661",
  subCard: "#F0F5F2",
  subBorder: "#D4DDD9",
  ctaBg: "#7FAF95",
  ctaText: "#FFFFFF",
  footer: "#8A9590",
  faint: "#6A7571",
};

const DARK_TOKENS = {
  // Dark mode
  bg: "#0B0F0E",
  card: "#121816",
  border: "#26302D",
  text: "#C8D4CE",
  muted: "#B8C5BF",
  subCard: "#0E1412",
  subBorder: "#22302A",
  ctaBg: "#7FAF95",
  ctaText: "#0B0F0E",
  footer: "#5F6B66",
  faint: "#7F8C86",
};

const darkModeStyles = `
  @media (prefers-color-scheme: dark) {
    html, body, .ll-body, .ll-container { background-color: ${DARK_TOKENS.bg} !important; }
    .ll-card { background-color: ${DARK_TOKENS.card} !important; border-color: ${DARK_TOKENS.border} !important; }
    .ll-callout { background-color: ${DARK_TOKENS.subCard} !important; border-color: ${DARK_TOKENS.subBorder} !important; }
    .ll-h1, .ll-h2, .ll-emph, .ll-brand, .ll-signature { color: ${DARK_TOKENS.text} !important; }
    .ll-p, .ll-bullets, .ll-link { color: ${DARK_TOKENS.muted} !important; }
    .ll-hr { border-color: ${DARK_TOKENS.border} !important; margin-bottom: 25px !important; }
    .ll-button { background-color: ${DARK_TOKENS.ctaBg} !important; color: ${DARK_TOKENS.ctaText} !important; }
    .ll-footer { color: ${DARK_TOKENS.footer} !important; }
    .ll-footer-link { color: ${DARK_TOKENS.faint} !important; }
  }
`;

export default function AnnouncementEmail({
  recipientFirstName,
  subject = "Announcement from Loam Logger",
  previewText,
  messageContent,
  unsubscribeUrl,
}: AnnouncementEmailProps) {
  // Sanitize user-provided inputs
  const safeName = sanitizeUserInput(recipientFirstName);
  const safeSubject = sanitizeUserInput(subject, 200);
  const greeting = safeName ? `Hi ${safeName},` : "Hi there,";

  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style dangerouslySetInnerHTML={{ __html: darkModeStyles }} />
      </Head>
      <Preview>{previewText || safeSubject}</Preview>

      <Body className="ll-body" style={styles.body}>
        <Container className="ll-container" style={styles.container}>
          {/* Brand */}
          <Section style={{ padding: "8px 6px 14px 6px" }}>
            <Text className="ll-brand" style={styles.brand}>
              LoamLogger
            </Text>
          </Section>

          {/* Main Card */}
          <Section className="ll-card" style={styles.card}>
            <Heading className="ll-h1" style={styles.h1}>
              {safeSubject}
            </Heading>

            <Text className="ll-p" style={styles.p}>{greeting}</Text>

            {messageContent ? (
              <Section style={{ margin: "12px 0" }}>
                {messageContent}
              </Section>
            ) : (
              <Text className="ll-p" style={styles.p}>
                We have an update to share with you.
              </Text>
            )}

            <Text
              className="ll-signature"
              style={{
                ...styles.p,
                marginTop: 14,
                marginBottom: 0,
                color: TOKENS.text,
                fontWeight: 800,
              }}
            >
              – Ryan
            </Text>
          </Section>

          {/* Footer */}
          <Section style={styles.footer}>
            <Text className="ll-footer" style={{ ...styles.footerText, marginBottom: 0 }}>
              Loam Logger • You're receiving this because you signed up for early access.
            </Text>
            {unsubscribeUrl ? (
              <Text className="ll-footer" style={{ ...styles.footerText, marginTop: 6 }}>
                <Link href={unsubscribeUrl} className="ll-footer-link" style={styles.footerLink}>
                  Unsubscribe
                </Link>
              </Text>
            ) : null}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// Helper components for use in messageContent
export const AnnouncementText = ({ children }: { children: React.ReactNode }) => (
  <Text className="ll-p" style={styles.p}>{children}</Text>
);

export const AnnouncementEmph = ({ children }: { children: React.ReactNode }) => (
  <span className="ll-emph" style={styles.emph}>{children}</span>
);

export const AnnouncementLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <Link href={href} className="ll-link" style={styles.link}>{children}</Link>
);

export const AnnouncementCallout = ({ children }: { children: React.ReactNode }) => (
  <Section className="ll-callout" style={styles.callout}>{children}</Section>
);

export const AnnouncementHr = () => (
  <Hr className="ll-hr" style={styles.hr} />
);

const styles: Record<string, React.CSSProperties> = {
  body: {
    margin: 0,
    padding: 0,
    backgroundColor: TOKENS.bg,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
  },
  container: {
    width: "100%",
    maxWidth: 800,
    margin: "0 auto",
    padding: "22px 14px 28px",
  },
  brand: {
    fontSize: 14,
    letterSpacing: 0.2,
    fontWeight: 800,
    color: TOKENS.text,
    margin: 0,
  },
  card: {
    backgroundColor: TOKENS.card,
    border: `1px solid ${TOKENS.border}`,
    borderRadius: 18,
    padding: "22px 20px",
  },
  h1: {
    fontSize: 22,
    lineHeight: "1.25",
    color: TOKENS.text,
    fontWeight: 800,
    margin: "0 0 12px 0",
  },
  h2: {
    fontSize: 16,
    lineHeight: "1.35",
    color: TOKENS.text,
    fontWeight: 800,
    margin: "0 0 10px 0",
  },
  p: {
    fontSize: 14,
    lineHeight: "1.75",
    color: TOKENS.muted,
    margin: "0 0 12px 0",
  },
  emph: {
    color: TOKENS.text,
    fontWeight: 800,
  },
  callout: {
    backgroundColor: TOKENS.subCard,
    border: `1px solid ${TOKENS.subBorder}`,
    borderRadius: 14,
    padding: "12px 12px",
    margin: "10px 0 14px",
  },
  hr: {
    borderColor: TOKENS.border,
    margin: "14px 0 10px",
  },
  button: {
    display: "inline-block",
    backgroundColor: TOKENS.ctaBg,
    color: TOKENS.ctaText,
    borderRadius: 999,
    padding: "12px 16px",
    fontSize: 14,
    fontWeight: 800,
    textDecoration: "none",
  },
  link: {
    color: TOKENS.muted,
    textDecoration: "underline",
  },
  footer: {
    padding: "14px 6px 0 6px",
  },
  footerText: {
    fontSize: 11,
    lineHeight: "1.6",
    color: TOKENS.footer,
    margin: 0,
  },
  footerLink: {
    color: TOKENS.faint,
    textDecoration: "underline",
  },
};

// Helper type for the legacy getAnnouncementEmailHtml function
export type GetAnnouncementEmailHtmlParams = {
  name?: string;
  subject: string;
  messageHtml: string;
  unsubscribeUrl?: string;
};

/**
 * Render the announcement email to HTML string.
 * This is a convenience function for use by the email scheduler.
 */
export async function getAnnouncementEmailHtml({
  name,
  subject,
  messageHtml,
  unsubscribeUrl,
}: GetAnnouncementEmailHtmlParams): Promise<string> {
  // Create a React element that renders the HTML content
  const messageContent = (
    <div dangerouslySetInnerHTML={{ __html: messageHtml }} />
  );

  const element = (
    <AnnouncementEmail
      recipientFirstName={name}
      subject={subject}
      messageContent={messageContent}
      unsubscribeUrl={unsubscribeUrl}
    />
  );

  return render(element);
}

/** Template configuration for admin email UI */
export const templateConfig: TemplateConfig = {
  id: "announcement",
  displayName: "Announcement",
  description: "Generic announcement with custom message content",
  defaultSubject: "Announcement from Loam Logger",
  emailType: "announcement",
  templateVersion: ANNOUNCEMENT_TEMPLATE_VERSION,
  adminVisible: true,
  parameters: [
    { key: "recipientFirstName", label: "First Name", type: "text", required: false, autoFill: "recipientFirstName" },
    { key: "subject", label: "Heading", type: "text", required: true, helpText: "The heading shown inside the email card" },
    { key: "previewText", label: "Preview Text", type: "text", required: false, helpText: "Short preview shown in email clients" },
    { key: "messageHtml", label: "Message Content", type: "textarea", required: true, helpText: "Plain text - newlines converted to line breaks" },
    { key: "unsubscribeUrl", label: "Unsubscribe URL", type: "hidden", required: false, autoFill: "unsubscribeUrl" },
  ],
  render: (props) => {
    // Convert messageHtml text to React content
    const messageHtml = props.messageHtml as string | undefined;
    const messageContent = messageHtml ? (
      <div dangerouslySetInnerHTML={{ __html: escapeHtml(messageHtml).replace(/\n/g, "<br>") }} />
    ) : undefined;
    return React.createElement(AnnouncementEmail, {
      ...props,
      messageContent,
    } as AnnouncementEmailProps);
  },
};
