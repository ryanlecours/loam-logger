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

export type EmailVerificationEmailProps = {
  recipientFirstName?: string;
  verifyUrl: string;
  expiresInHours?: number;
  unverifiedAccountTtlDays?: number;
};

export default function EmailVerificationEmail({
  recipientFirstName,
  verifyUrl,
  expiresInHours = 24,
  unverifiedAccountTtlDays = 14,
}: EmailVerificationEmailProps) {
  const safeName = sanitizeUserInput(recipientFirstName);
  const greeting = safeName ? `Hi ${safeName},` : "Hi there,";

  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style dangerouslySetInnerHTML={{ __html: darkModeStyles }} />
      </Head>

      <Preview>One tap to finish setting up your Loam Logger account.</Preview>

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
              {greeting}
            </Text>

            <Text className="ll-p" style={baseStyles.p}>
              Thanks for signing up for Loam Logger. Tap the button below to confirm this is your
              email, then sign in to get started.
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
                <strong>Didn&apos;t sign up?</strong> You can ignore this email. The account
                can&apos;t be used until this address is confirmed, and it will be deleted after{" "}
                {unverifiedAccountTtlDays} days.
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
              – Ryan
            </Text>
          </Section>

          <Section style={baseStyles.footer}>
            <Text className="ll-footer" style={{ ...baseStyles.footerText, marginBottom: 0 }}>
              Loam Logger • You received this because this address was used to sign up.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export function getEmailVerificationSubject(): string {
  return "Confirm your email for Loam Logger";
}

/**
 * Build the React element for the verification email.
 * Keeping the JSX in the template module lets the service file stay .ts.
 */
export function buildEmailVerificationElement(props: EmailVerificationEmailProps) {
  return <EmailVerificationEmail {...props} />;
}
