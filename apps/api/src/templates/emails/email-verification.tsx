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

export const EMAIL_VERIFICATION_TEMPLATE_VERSION = "1.0.0";

// No name prop on purpose: bots sign up with spam links as the name so that
// any email greeting them by name carries the spam from our domain. The only
// rider-supplied value here is the recipient's own address.
export type EmailVerificationEmailProps = {
  email?: string;
  verifyUrl: string;
  expiresInHours?: number;
  supportEmail?: string;
};

export default function EmailVerificationEmail({
  email = "rider@example.com",
  verifyUrl,
  expiresInHours = 24,
  supportEmail = "ryan.lecours@loamlogger.app",
}: EmailVerificationEmailProps) {
  const safeEmail = sanitizeUserInput(email, 254);

  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style dangerouslySetInnerHTML={{ __html: darkModeStyles }} />
      </Head>

      <Preview>Confirm your email for Loam Logger</Preview>

      <Body className="ll-body" style={baseStyles.body}>
        <Container className="ll-container" style={baseStyles.container}>
          <Section style={{ padding: "8px 6px 14px 6px" }}>
            <Text className="ll-brand" style={baseStyles.brand}>
              LoamLogger
            </Text>
          </Section>

          <Section className="ll-card" style={baseStyles.card}>
            <Heading className="ll-h1" style={baseStyles.h1}>
              Confirm your email
            </Heading>

            <Text className="ll-p" style={baseStyles.p}>
              Someone created a Loam Logger account with this address ({safeEmail}). If that was
              you, confirm it below.
            </Text>

            <Section style={{ textAlign: "center", margin: "20px 0" }}>
              <Button
                className="ll-button"
                href={verifyUrl}
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
                Confirm email
              </Button>
            </Section>

            <Text className="ll-p" style={baseStyles.p}>
              This link expires in {expiresInHours} hours. If the button doesn&apos;t work, paste
              this URL into your browser:
            </Text>

            <Text
              className="ll-p"
              style={{ ...baseStyles.p, wordBreak: "break-all", fontSize: 12 }}
            >
              <Link href={verifyUrl} style={{ color: TOKENS.text }}>
                {verifyUrl}
              </Link>
            </Text>

            <Hr className="ll-hr" style={baseStyles.hr} />

            <Section className="ll-warning" style={baseStyles.warning}>
              <Text className="ll-warning-text" style={baseStyles.warningText}>
                <strong>If you didn&apos;t sign up</strong>, you can ignore this email. Nothing
                happens unless the link is used. Questions? Contact us at{" "}
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
              Loam Logger • This is an account notification and cannot be unsubscribed.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export function getEmailVerificationEmailSubject(): string {
  return "Confirm your email for Loam Logger";
}

/**
 * Build the React element for the email verification email.
 * Keeping the JSX in the template module lets the service file stay .ts.
 */
export function buildEmailVerificationEmailElement(props: EmailVerificationEmailProps) {
  return <EmailVerificationEmail {...props} />;
}
