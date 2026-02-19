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
import { TOKENS, darkModeStyles, baseStyles } from "./shared-styles";

export const PASSWORD_ADDED_TEMPLATE_VERSION = "1.0.1";

export type PasswordAddedEmailProps = {
  recipientFirstName?: string;
  email?: string;
  supportEmail?: string;
  unsubscribeUrl?: string;
};

export default function PasswordAddedEmail({
  recipientFirstName,
  email = "rider@example.com",
  supportEmail = "ryan.lecours@loamlogger.app",
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

      <Body className="ll-body" style={baseStyles.body}>
        <Container className="ll-container" style={baseStyles.container}>
          {/* Brand */}
          <Section style={{ padding: "8px 6px 14px 6px" }}>
            <Text className="ll-brand" style={baseStyles.brand}>
              LoamLogger
            </Text>
          </Section>

          {/* Main Card */}
          <Section className="ll-card" style={baseStyles.card}>
            <Heading className="ll-h1" style={baseStyles.h1}>
              Password added to your account
            </Heading>

            <Text className="ll-p" style={baseStyles.p}>
              {greeting}
            </Text>

            <Text className="ll-p" style={baseStyles.p}>
              A password has been added to your Loam Logger account ({safeEmail}).
              You can now sign in using either Google or your email and password.
            </Text>

            <Hr className="ll-hr" style={baseStyles.hr} />

            {/* Security Warning */}
            <Section className="ll-warning" style={baseStyles.warning}>
              <Text className="ll-warning-text" style={baseStyles.warningText}>
                <strong>If you did not make this change</strong>, please contact us immediately at{" "}
                <Link href={`mailto:${supportEmail}`} style={baseStyles.warningLink}>
                  {supportEmail}
                </Link>
                . Someone may have unauthorized access to your account.
              </Text>
            </Section>

            <Hr className="ll-hr" style={baseStyles.hr} />

            <Text className="ll-p" style={baseStyles.p}>
              If you made this change, no action is needed. You can now use your password
              to sign in on any device.
            </Text>

            <Text
              className="ll-signature"
              style={{
                ...baseStyles.p,
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
          <Section style={baseStyles.footer}>
            <Text className="ll-footer" style={{ ...baseStyles.footerText, marginBottom: 0 }}>
              Loam Logger • This is a security notification about your account.
            </Text>

            {unsubscribeUrl ? (
              <Text className="ll-footer" style={{ ...baseStyles.footerText, marginTop: 6 }}>
                <Link href={unsubscribeUrl} className="ll-footer-link" style={baseStyles.footerLink}>
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
