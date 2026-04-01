import * as React from "react";
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
  Button,
  Hr,
} from "@react-email/components";
import { render } from "@react-email/render";
import { sanitizeUserInput } from "../../lib/html";
import {
  TOKENS,
  darkModeStyles,
  baseStyles,
} from "./shared-styles";

export const PAYMENT_FAILED_TEMPLATE_VERSION = "1.0.0";

export type PaymentFailedEmailProps = {
  recipientFirstName?: string;
  settingsUrl?: string;
};

export default function PaymentFailedEmail({
  recipientFirstName,
  settingsUrl = "https://loamlogger.app/settings",
}: PaymentFailedEmailProps) {
  const safeName = sanitizeUserInput(recipientFirstName);
  const greeting = safeName ? `Hey ${safeName},` : "Hey there,";

  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style dangerouslySetInnerHTML={{ __html: darkModeStyles }} />
      </Head>

      <Preview>
        We couldn't process your Loam Logger payment — please update your card.
      </Preview>

      <Body className="ll-body" style={styles.body}>
        <Container className="ll-container" style={styles.container}>
          <Section style={{ padding: "8px 6px 14px 6px" }}>
            <Text className="ll-brand" style={styles.brand}>
              LoamLogger
            </Text>
          </Section>

          <Section className="ll-card" style={styles.card}>
            <Heading className="ll-h1" style={styles.h1}>
              Payment could not be processed
            </Heading>

            <Text className="ll-p" style={styles.p}>
              {greeting}
            </Text>

            <Text className="ll-p" style={styles.p}>
              We tried to charge your card for your Loam Logger Pro subscription but the
              payment did not go through.
            </Text>

            <Section className="ll-warning" style={styles.warning}>
              <Text className="ll-warning-text" style={styles.warningText}>
                If the payment issue is not resolved, your account will be downgraded to the
                free tier and you will need to select one bike to keep.
              </Text>
            </Section>

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              How to fix this
            </Heading>

            <Text className="ll-p" style={styles.p}>
              Head to your settings and click <span className="ll-emph" style={styles.emph}>Manage</span> next
              to your subscription to update your payment method. Stripe will automatically
              retry the charge.
            </Text>

            <Section style={{ textAlign: "center", padding: "6px 0 10px" }}>
              <Button href={settingsUrl} className="ll-button" style={styles.button}>
                Update payment method
              </Button>
            </Section>

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              Common reasons
            </Heading>

            <Text className="ll-bullets" style={styles.bullets}>
              • Expired card
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • Insufficient funds
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • Card issuer declined the charge
            </Text>

            <Text className="ll-p" style={{ ...styles.p, marginTop: 14 }}>
              If you have any questions or think this is an error, reply to this email and
              I will take a look.
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
              Ryan LeCours
            </Text>

            <Text className="ll-p" style={{ ...styles.p, marginBottom: 0 }}>
              Founder, Loam Logger
            </Text>
          </Section>

          <Section style={styles.footer}>
            <Text className="ll-footer" style={{ ...styles.footerText, marginBottom: 0 }}>
              Loam Logger is a product of Loam Labs LLC.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const styles: Record<string, React.CSSProperties> = {
  ...baseStyles,
  h2: {
    fontSize: 16,
    lineHeight: "1.35",
    color: TOKENS.text,
    fontWeight: 800,
    margin: "0 0 10px 0",
  },
  emph: {
    color: TOKENS.text,
    fontWeight: 800,
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
  bullets: {
    fontSize: 14,
    lineHeight: "1.75",
    color: TOKENS.muted,
    margin: "0 0 8px 0",
    paddingLeft: 16,
    textIndent: -16,
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
};

export function getPaymentFailedEmailSubject(): string {
  return "Action needed: update your payment method";
}

export type GetPaymentFailedEmailHtmlParams = {
  name?: string;
};

export async function getPaymentFailedEmailHtml({
  name,
}: GetPaymentFailedEmailHtmlParams): Promise<string> {
  const element = (
    <PaymentFailedEmail
      recipientFirstName={name}
    />
  );

  return render(element);
}
