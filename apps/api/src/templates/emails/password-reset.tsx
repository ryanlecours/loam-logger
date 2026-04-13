import * as React from "react";
import {
  Body,
  Button,
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
import { sanitizeUserInput } from "../../lib/html";
import { TOKENS, darkModeStyles, baseStyles } from "./shared-styles";

export const PASSWORD_RESET_TEMPLATE_VERSION = "1.0.0";

export type PasswordResetEmailProps = {
  recipientFirstName?: string;
  email?: string;
  resetUrl: string;
  expiresInMinutes?: number;
  supportEmail?: string;
};

export default function PasswordResetEmail({
  recipientFirstName,
  email = "rider@example.com",
  resetUrl,
  expiresInMinutes = 60,
  supportEmail = "ryan.lecours@loamlogger.app",
}: PasswordResetEmailProps) {
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

      <Preview>Reset your Loam Logger password</Preview>

      <Body className="ll-body" style={baseStyles.body}>
        <Container className="ll-container" style={baseStyles.container}>
          <Section style={{ padding: "8px 6px 14px 6px" }}>
            <Text className="ll-brand" style={baseStyles.brand}>
              LoamLogger
            </Text>
          </Section>

          <Section className="ll-card" style={baseStyles.card}>
            <Heading className="ll-h1" style={baseStyles.h1}>
              Reset your password
            </Heading>

            <Text className="ll-p" style={baseStyles.p}>
              {greeting}
            </Text>

            <Text className="ll-p" style={baseStyles.p}>
              We received a request to reset the password for your Loam Logger account ({safeEmail}).
              Click the button below to choose a new password.
            </Text>

            <Section style={{ textAlign: "center", margin: "20px 0" }}>
              <Button
                className="ll-button"
                href={resetUrl}
                style={{
                  backgroundColor: TOKENS.ctaBg,
                  color: TOKENS.ctaText,
                  padding: "12px 24px",
                  borderRadius: 10,
                  fontSize: 15,
                  fontWeight: 700,
                  textDecoration: "none",
                  display: "inline-block",
                }}
              >
                Reset password
              </Button>
            </Section>

            <Text className="ll-p" style={baseStyles.p}>
              This link will expire in {expiresInMinutes} minutes. If the button doesn&apos;t work,
              paste this URL into your browser:
            </Text>

            <Text
              className="ll-p"
              style={{ ...baseStyles.p, wordBreak: "break-all", fontSize: 12 }}
            >
              <Link href={resetUrl} style={{ color: TOKENS.text }}>
                {resetUrl}
              </Link>
            </Text>

            <Hr className="ll-hr" style={baseStyles.hr} />

            <Section className="ll-warning" style={baseStyles.warning}>
              <Text className="ll-warning-text" style={baseStyles.warningText}>
                <strong>If you didn&apos;t request this</strong>, you can safely ignore this email —
                your password won&apos;t change. If you&apos;re concerned about your account, contact us at{" "}
                <Link href={`mailto:${supportEmail}`} style={baseStyles.warningLink}>
                  {supportEmail}
                </Link>
                .
              </Text>
            </Section>

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

          <Section style={baseStyles.footer}>
            <Text className="ll-footer" style={{ ...baseStyles.footerText, marginBottom: 0 }}>
              Loam Logger • This is a security notification and cannot be unsubscribed.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export function getPasswordResetEmailSubject(): string {
  return "Reset your Loam Logger password";
}
