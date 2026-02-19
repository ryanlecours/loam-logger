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
import { sanitizeUserInput } from "../../lib/html";

export const PASSWORD_ADDED_TEMPLATE_VERSION = "1.0.0";

export type PasswordAddedEmailProps = {
  recipientFirstName?: string;
  email?: string;
  supportEmail?: string;
  appUrl?: string;
  unsubscribeUrl?: string;
};

const TOKENS = {
  bg: "#FBFAF2",
  card: "#F4F7F5",
  border: "#D4DDD9",
  text: "#121816",
  muted: "#5A6661",
  subCard: "#F0F5F2",
  subBorder: "#D4DDD9",
  footer: "#8A9590",
  faint: "#6A7571",
  warning: "#B45309",
  warningBg: "#FEF3C7",
  warningBorder: "#FCD34D",
};

const DARK_TOKENS = {
  bg: "#0B0F0E",
  card: "#121816",
  border: "#26302D",
  text: "#C8D4CE",
  muted: "#B8C5BF",
  subCard: "#0E1412",
  subBorder: "#22302A",
  footer: "#5F6B66",
  faint: "#7F8C86",
  warning: "#FCD34D",
  warningBg: "#422006",
  warningBorder: "#92400E",
};

const darkModeStyles = `
  @media (prefers-color-scheme: dark) {
    html, body, .ll-body, .ll-container { background-color: ${DARK_TOKENS.bg} !important; }
    .ll-card { background-color: ${DARK_TOKENS.card} !important; border-color: ${DARK_TOKENS.border} !important; }
    .ll-callout { background-color: ${DARK_TOKENS.subCard} !important; border-color: ${DARK_TOKENS.subBorder} !important; }
    .ll-warning { background-color: ${DARK_TOKENS.warningBg} !important; border-color: ${DARK_TOKENS.warningBorder} !important; }
    .ll-warning-text { color: ${DARK_TOKENS.warning} !important; }
    .ll-h1, .ll-h2, .ll-emph, .ll-brand, .ll-signature { color: ${DARK_TOKENS.text} !important; }
    .ll-p, .ll-bullets, .ll-link { color: ${DARK_TOKENS.muted} !important; }
    .ll-hr { border-color: ${DARK_TOKENS.border} !important; }
    .ll-footer { color: ${DARK_TOKENS.footer} !important; }
    .ll-footer-link { color: ${DARK_TOKENS.faint} !important; }
  }
`;

export default function PasswordAddedEmail({
  recipientFirstName,
  email = "rider@example.com",
  supportEmail = "ryan.lecours@loamlogger.app",
  appUrl = "https://loamlogger.app",
  unsubscribeUrl,
}: PasswordAddedEmailProps) {
  const safeName = sanitizeUserInput(recipientFirstName);
  const safeEmail = sanitizeUserInput(email, 254);

  const greeting = safeName ? `Hi ${safeName},` : "Hi there,";

  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style dangerouslySetInnerHTML={{ __html: darkModeStyles }} />
      </Head>

      <Preview>A password has been added to your Loam Logger account</Preview>

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
              Password added to your account
            </Heading>

            <Text className="ll-p" style={styles.p}>
              {greeting}
            </Text>

            <Text className="ll-p" style={styles.p}>
              A password has been added to your Loam Logger account ({safeEmail}).
              You can now sign in using either Google or your email and password.
            </Text>

            <Hr className="ll-hr" style={styles.hr} />

            {/* Security Warning */}
            <Section className="ll-warning" style={styles.warning}>
              <Text className="ll-warning-text" style={styles.warningText}>
                <strong>If you did not make this change</strong>, please contact us immediately at{" "}
                <Link href={`mailto:${supportEmail}`} style={styles.warningLink}>
                  {supportEmail}
                </Link>
                . Someone may have unauthorized access to your account.
              </Text>
            </Section>

            <Hr className="ll-hr" style={styles.hr} />

            <Text className="ll-p" style={styles.p}>
              If you made this change, no action is needed. You can now use your password
              to sign in on any device.
            </Text>

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
              – The Loam Logger Team
            </Text>
          </Section>

          {/* Footer */}
          <Section style={styles.footer}>
            <Text className="ll-footer" style={{ ...styles.footerText, marginBottom: 0 }}>
              Loam Logger • This is a security notification about your account.
            </Text>

            {unsubscribeUrl ? (
              <Text className="ll-footer" style={{ ...styles.footerText, marginTop: 6 }}>
                <Link href={unsubscribeUrl} className="ll-footer-link" style={styles.footerLink}>
                  Unsubscribe from marketing emails
                </Link>
              </Text>
            ) : null}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const styles: Record<string, React.CSSProperties> = {
  body: {
    margin: 0,
    padding: 0,
    backgroundColor: TOKENS.bg,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
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
  p: {
    fontSize: 14,
    lineHeight: "1.75",
    color: TOKENS.muted,
    margin: "0 0 12px 0",
  },
  hr: {
    borderColor: TOKENS.border,
    margin: "14px 0 10px",
  },
  warning: {
    backgroundColor: TOKENS.warningBg,
    border: `1px solid ${TOKENS.warningBorder}`,
    borderRadius: 14,
    padding: "12px 12px",
    margin: "10px 0 14px",
  },
  warningText: {
    fontSize: 14,
    lineHeight: "1.75",
    color: TOKENS.warning,
    margin: 0,
  },
  warningLink: {
    color: TOKENS.warning,
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

/**
 * Get the password added email subject line.
 */
export function getPasswordAddedEmailSubject(): string {
  return "Password added to your Loam Logger account";
}

/**
 * Render the password added email to HTML string.
 */
export async function getPasswordAddedEmailHtml({
  name,
  email,
  unsubscribeUrl,
}: {
  name?: string;
  email: string;
  unsubscribeUrl?: string;
}): Promise<string> {
  const element = (
    <PasswordAddedEmail
      recipientFirstName={name}
      email={email}
      unsubscribeUrl={unsubscribeUrl}
    />
  );

  return render(element);
}
