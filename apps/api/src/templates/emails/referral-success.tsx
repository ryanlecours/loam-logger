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

export const REFERRAL_SUCCESS_TEMPLATE_VERSION = "1.0.0";

export type ReferralSuccessEmailProps = {
  recipientFirstName?: string;
  referredName?: string;
  dashboardUrl?: string;
  settingsUrl?: string;
};

export default function ReferralSuccessEmail({
  recipientFirstName,
  referredName,
  dashboardUrl = "https://loamlogger.app/dashboard",
  settingsUrl = "https://loamlogger.app/settings",
}: ReferralSuccessEmailProps) {
  const safeName = sanitizeUserInput(recipientFirstName);
  const safeReferredName = sanitizeUserInput(referredName);
  const greeting = safeName ? `Hey ${safeName},` : "Hey there,";

  const friendLabel = safeReferredName || "Your friend";

  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style dangerouslySetInnerHTML={{ __html: darkModeStyles }} />
      </Head>

      <Preview>
        {friendLabel} joined Loam Logger — you have been upgraded to Full Bike Analysis.
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
              You have been upgraded
            </Heading>

            <Text className="ll-p" style={styles.p}>
              {greeting}
            </Text>

            <Text className="ll-p" style={styles.p}>
              <span className="ll-emph" style={styles.emph}>{friendLabel}</span> just
              finished setting up their Loam Logger account using your referral link.
              As a thank you, you have unlocked{" "}
              <span className="ll-emph" style={styles.emph}>Full Bike Analysis</span>: wear
              tracking on up to 23+ components on your bike.
            </Text>

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              What just unlocked
            </Heading>

            <Section className="ll-callout" style={styles.callout}>
              <Text className="ll-bullets" style={styles.bullets}>
                • <span className="ll-emph" style={styles.emph}>23+ component types</span> — drivetrain,
                tires, wheels, dropper, headset, bottom bracket, and more
              </Text>
              <Text className="ll-bullets" style={styles.bullets}>
                • <span className="ll-emph" style={styles.emph}>Complete wear tracking</span> — every part on
                your bike is now monitored
              </Text>
            </Section>

            <Text className="ll-p" style={styles.p}>
              You still have a one-bike limit on the free tier. If you want unlimited bikes,
              you can upgrade to Pro from your{" "}
              <Link href={settingsUrl} className="ll-link" style={styles.link}>
                settings page
              </Link>.
            </Text>

            <Section style={{ textAlign: "center", padding: "6px 0 10px" }}>
              <Button href={dashboardUrl} className="ll-button" style={styles.button}>
                Check your dashboard
              </Button>
            </Section>

            <Hr className="ll-hr" style={styles.hr} />

            <Text className="ll-p" style={styles.p}>
              Thanks for spreading the word. Riders telling other riders is how Loam Logger grows.
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

export function getReferralSuccessEmailSubject(referredName?: string): string {
  const friend = referredName || "Your friend";
  return `${friend} joined — you've been upgraded to Full Bike Analysis`;
}

export type GetReferralSuccessEmailHtmlParams = {
  name?: string;
  referredName?: string;
};

export async function getReferralSuccessEmailHtml({
  name,
  referredName,
}: GetReferralSuccessEmailHtmlParams): Promise<string> {
  const element = (
    <ReferralSuccessEmail
      recipientFirstName={name}
      referredName={referredName}
    />
  );

  return render(element);
}
