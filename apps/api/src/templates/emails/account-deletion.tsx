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

export const ACCOUNT_DELETION_TEMPLATE_VERSION = "1.0.0";

export type AccountDeletionEmailProps = {
  recipientFirstName?: string;
  email?: string;
  confirmUrl: string;
  expiresInMinutes?: number;
  supportEmail?: string;
};

export default function AccountDeletionEmail({
  recipientFirstName,
  email = "rider@example.com",
  confirmUrl,
  expiresInMinutes = 60,
  supportEmail = "ryan.lecours@loamlogger.app",
}: AccountDeletionEmailProps) {
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

      <Preview>Confirm that you want to delete your Loam Logger account</Preview>

      <Body className="ll-body" style={baseStyles.body}>
        <Container className="ll-container" style={baseStyles.container}>
          <Section style={{ padding: "8px 6px 14px 6px" }}>
            <Text className="ll-brand" style={baseStyles.brand}>
              LoamLogger
            </Text>
          </Section>

          <Section className="ll-card" style={baseStyles.card}>
            <Heading className="ll-h1" style={baseStyles.h1}>
              Confirm account deletion
            </Heading>

            <Text className="ll-p" style={baseStyles.p}>
              {greeting}
            </Text>

            <Text className="ll-p" style={baseStyles.p}>
              We received a request to delete the Loam Logger account for {safeEmail}. Deleting it
              permanently removes your bikes, components, service history and rides, and cannot be
              undone.
            </Text>

            <Text className="ll-p" style={baseStyles.p}>
              If you pay for Loam Logger Pro through the App Store or Google Play, cancel that
              subscription in the store first. Deleting your account does not cancel it.
            </Text>

            <Text className="ll-p" style={baseStyles.p}>
              To go ahead, open the confirmation page and confirm there. Nothing is deleted until
              you do.
            </Text>

            <Section style={{ textAlign: "center", margin: "20px 0" }}>
              <Button
                className="ll-button"
                href={confirmUrl}
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
                Review and confirm
              </Button>
            </Section>

            <Text className="ll-p" style={baseStyles.p}>
              This link expires in {expiresInMinutes} minutes. If the button doesn&apos;t work,
              paste this URL into your browser:
            </Text>

            <Text
              className="ll-p"
              style={{ ...baseStyles.p, wordBreak: "break-all", fontSize: 12 }}
            >
              <Link className="ll-link" href={confirmUrl} style={{ color: TOKENS.text }}>
                {confirmUrl}
              </Link>
            </Text>

            <Hr className="ll-hr" style={baseStyles.hr} />

            <Section className="ll-warning" style={baseStyles.warning}>
              <Text className="ll-warning-text" style={baseStyles.warningText}>
                <strong>If you didn&apos;t request this</strong>, ignore this email and your account
                stays as it is. If you&apos;re concerned about your account, contact us at{" "}
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

export function getAccountDeletionEmailSubject(): string {
  return "Confirm your Loam Logger account deletion";
}

/**
 * Build the React element for the account deletion email.
 * Keeping the JSX in the template module lets the service file stay .ts.
 */
export function buildAccountDeletionEmailElement(props: AccountDeletionEmailProps) {
  return <AccountDeletionEmail {...props} />;
}
