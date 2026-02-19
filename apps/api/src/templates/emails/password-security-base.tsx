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
import { sanitizeUserInput } from "../../lib/html";
import { TOKENS, darkModeStyles, baseStyles } from "./shared-styles";

export type PasswordSecurityEmailProps = {
  recipientFirstName?: string;
  email?: string;
  supportEmail?: string;
};

type PasswordSecurityEmailConfig = {
  previewText: string;
  heading: string;
  bodyText: (safeEmail: string) => string;
  warningText: React.ReactNode;
  confirmationText: string;
};

/**
 * Base component for password security emails (added/changed).
 * Provides consistent structure, styling, and security messaging.
 */
export function PasswordSecurityEmailBase({
  recipientFirstName,
  email = "rider@example.com",
  supportEmail = "ryan.lecours@loamlogger.app",
  config,
}: PasswordSecurityEmailProps & { config: PasswordSecurityEmailConfig }) {
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

      <Preview>{config.previewText}</Preview>

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
              {config.heading}
            </Heading>

            <Text className="ll-p" style={baseStyles.p}>
              {greeting}
            </Text>

            <Text className="ll-p" style={baseStyles.p}>
              {config.bodyText(safeEmail)}
            </Text>

            <Hr className="ll-hr" style={baseStyles.hr} />

            {/* Security Warning */}
            <Section className="ll-warning" style={baseStyles.warning}>
              <Text className="ll-warning-text" style={baseStyles.warningText}>
                <strong>If you did not make this change</strong>, {config.warningText}{" "}
                <Link href={`mailto:${supportEmail}`} style={baseStyles.warningLink}>
                  {supportEmail}
                </Link>
                .
              </Text>
            </Section>

            <Hr className="ll-hr" style={baseStyles.hr} />

            <Text className="ll-p" style={baseStyles.p}>
              {config.confirmationText}
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

          {/* Footer - No unsubscribe link for security emails */}
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
