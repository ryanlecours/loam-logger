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

export const DOWNGRADE_NOTICE_TEMPLATE_VERSION = "1.0.0";

export type DowngradeNoticeEmailProps = {
  recipientFirstName?: string;
  dashboardUrl?: string;
  pricingUrl?: string;
};

export default function DowngradeNoticeEmail({
  recipientFirstName,
  dashboardUrl = "https://loamlogger.app/dashboard",
  pricingUrl = "https://loamlogger.app/pricing",
}: DowngradeNoticeEmailProps) {
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
        Your Pro subscription has ended — select a bike to keep tracking.
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
              Your Pro subscription has ended
            </Heading>

            <Text className="ll-p" style={styles.p}>
              {greeting}
            </Text>

            <Text className="ll-p" style={styles.p}>
              Your Loam Logger Pro subscription has been cancelled. Your account has been
              moved to the free tier.
            </Text>

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              What you need to do
            </Heading>

            <Text className="ll-p" style={styles.p}>
              Free accounts are limited to{" "}
              <span className="ll-emph" style={styles.emph}>one bike</span>. If you had
              multiple bikes on your account, you will need to log in and select which bike
              you want to keep tracking.
            </Text>

            <Section style={{ textAlign: "center", padding: "6px 0 10px" }}>
              <Button href={dashboardUrl} className="ll-button" style={styles.button}>
                Select your bike
              </Button>
            </Section>

            <Section className="ll-callout" style={styles.callout}>
              <Text className="ll-p" style={{ ...styles.p, margin: 0 }}>
                Your other bikes are not deleted. They are archived and will be fully restored
                with all their component data if you re-subscribe.
              </Text>
            </Section>

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              What stays the same
            </Heading>

            <Text className="ll-bullets" style={styles.bullets}>
              • All your ride history is preserved
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • Service logs and component history stay intact
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • Archived bikes keep their data and can be restored anytime
            </Text>

            <Hr className="ll-hr" style={styles.hr} />

            <Text className="ll-p" style={styles.p}>
              If this was a mistake or you would like to re-subscribe, you can upgrade
              again from the{" "}
              <Link href={pricingUrl} className="ll-link" style={styles.link}>
                pricing page
              </Link>{" "}
              at any time.
            </Text>

            <Text className="ll-p" style={styles.p}>
              Thanks for being a Pro subscriber. I hope to see you back.
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
 * Get the downgrade notice email subject line.
 */
export function getDowngradeNoticeEmailSubject(): string {
  return "Your Loam Logger Pro subscription has ended";
}

export type GetDowngradeNoticeEmailHtmlParams = {
  name?: string;
};

/**
 * Render the downgrade notice email to HTML string.
 */
export async function getDowngradeNoticeEmailHtml({
  name,
}: GetDowngradeNoticeEmailHtmlParams): Promise<string> {
  const element = (
    <DowngradeNoticeEmail
      recipientFirstName={name}
    />
  );

  return render(element);
}
