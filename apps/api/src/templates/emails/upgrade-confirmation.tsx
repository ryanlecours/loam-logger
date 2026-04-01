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

export const UPGRADE_CONFIRMATION_TEMPLATE_VERSION = "1.0.0";

export type UpgradeConfirmationEmailProps = {
  recipientFirstName?: string;
  dashboardUrl?: string;
  settingsUrl?: string;
};

export default function UpgradeConfirmationEmail({
  recipientFirstName,
  dashboardUrl = "https://loamlogger.app/dashboard",
  settingsUrl = "https://loamlogger.app/settings",
}: UpgradeConfirmationEmailProps) {
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
        Welcome to Pro: unlimited bikes, all components, advanced predictions.
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
              Welcome to Pro
            </Heading>

            <Text className="ll-p" style={styles.p}>
              {greeting}
            </Text>

            <Text className="ll-p" style={styles.p}>
              Your upgrade to <span className="ll-emph" style={styles.emph}>Loam Logger Pro</span> is
              confirmed. Here is what just unlocked for you:
            </Text>

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              What's new for you
            </Heading>

            <Section className="ll-callout" style={styles.callout}>
              <Text className="ll-bullets" style={styles.bullets}>
                • <span className="ll-emph" style={styles.emph}>Unlimited bikes</span> — add every bike in your garage
              </Text>
              <Text className="ll-bullets" style={styles.bullets}>
                • <span className="ll-emph" style={styles.emph}>All component types</span> — drivetrain, tires, wheels, dropper, headset, bottom bracket, and more
              </Text>
              <Text className="ll-bullets" style={styles.bullets}>
                • <span className="ll-emph" style={styles.emph}>Predictive wear algorithm</span> — factors in elevation, distance, and trail steepness
              </Text>
            </Section>

            <Text className="ll-p" style={styles.p}>
              If you were tracking a single bike before, now is a great time to add the rest of your fleet
              and set up components on each one.
            </Text>

            <Section style={{ textAlign: "center", padding: "6px 0 10px" }}>
              <Button href={dashboardUrl} className="ll-button" style={styles.button}>
                Open your dashboard
              </Button>
            </Section>

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              Managing your subscription
            </Heading>

            <Text className="ll-p" style={styles.p}>
              You can update your payment method, switch between monthly and annual billing,
              or cancel at any time from your{" "}
              <Link href={settingsUrl} className="ll-link" style={styles.link}>
                settings page
              </Link>.
            </Text>

            <Text className="ll-p" style={styles.p}>
              If you ever downgrade, your data stays safe. You will be asked to pick one bike to keep
              active, and the rest will be archived until you re-subscribe.
            </Text>

            <Hr className="ll-hr" style={styles.hr} />

            <Text className="ll-p" style={styles.p}>
              Thanks for supporting Loam Logger. Riders like you are the reason this
              project keeps moving forward.
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
  callout: {
    backgroundColor: TOKENS.subCard,
    border: `1px solid ${TOKENS.subBorder}`,
    borderRadius: 14,
    padding: "12px 12px",
    margin: "10px 0 14px",
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

/**
 * Get the upgrade confirmation email subject line.
 */
export function getUpgradeConfirmationEmailSubject(): string {
  return "Welcome to Loam Logger Pro";
}

export type GetUpgradeConfirmationEmailHtmlParams = {
  name?: string;
};

/**
 * Render the upgrade confirmation email to HTML string.
 */
export async function getUpgradeConfirmationEmailHtml({
  name,
}: GetUpgradeConfirmationEmailHtmlParams): Promise<string> {
  const element = (
    <UpgradeConfirmationEmail
      recipientFirstName={name}
    />
  );

  return render(element);
}
