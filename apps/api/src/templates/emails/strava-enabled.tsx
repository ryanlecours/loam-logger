import * as React from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { sanitizeUserInput } from "../../lib/html";
import type { TemplateConfig } from "./types";

export const STRAVA_INTEGRATION_LIVE_TEMPLATE_VERSION = "1.0.1";

export type StravaIntegrationLiveEmailProps = {
  recipientFirstName?: string;
  settingsUrl?: string;
  stravaConnectUrl?: string;
  unsubscribeUrl?: string;
  supportEmail?: string;
};

const TOKENS = {
  bg: "#FBFAF2",
  card: "#F4F7F5",
  border: "#D4DDD9",
  text: "#121816",
  muted: "#5A6661",
  subCard: "#F0F5F2",
  subBorder: "#D4DDD9",
  ctaBg: "#7FAF95",
  ctaText: "#FFFFFF",
  footer: "#8A9590",
  faint: "#6A7571",
};

const DARK_TOKENS = {
  bg: "#0B0F0E",
  card: "#121816",
  border: "#26302D",
  text: "#C8D4CE",
  muted: "#B8C5BF",
  subCard: "#0E1412",
  subBorder: "#22302A",
  ctaBg: "#7FAF95",
  ctaText: "#0B0F0E",
  footer: "#5F6B66",
  faint: "#7F8C86",
};

const darkModeStyles = `
  @media (prefers-color-scheme: dark) {
    html, body, .ll-body, .ll-container { background-color: ${DARK_TOKENS.bg} !important; }
    .ll-card { background-color: ${DARK_TOKENS.card} !important; border-color: ${DARK_TOKENS.border} !important; }
    .ll-callout { background-color: ${DARK_TOKENS.subCard} !important; border-color: ${DARK_TOKENS.subBorder} !important; }
    .ll-h1, .ll-h2, .ll-emph, .ll-brand, .ll-signature { color: ${DARK_TOKENS.text} !important; }
    .ll-p, .ll-bullets, .ll-link { color: ${DARK_TOKENS.muted} !important; }
    .ll-hr { border-color: ${DARK_TOKENS.border} !important; margin-bottom: 25px !important; }
    .ll-button { background-color: ${DARK_TOKENS.ctaBg} !important; color: ${DARK_TOKENS.ctaText} !important; }
    .ll-footer { color: ${DARK_TOKENS.footer} !important; }
    .ll-footer-link { color: ${DARK_TOKENS.faint} !important; }
  }
`;

export default function StravaIntegrationLiveEmail({
  recipientFirstName,
  settingsUrl = "https://loamlogger.app/settings",
  unsubscribeUrl,
  supportEmail = "ryan.lecours@loamlogger.app",
}: StravaIntegrationLiveEmailProps) {
  const safeName = sanitizeUserInput(recipientFirstName);
  const safeSettingsUrl = sanitizeUserInput(settingsUrl, 200);
  const safeSupportEmail = sanitizeUserInput(supportEmail, 200);

  const hello = safeName ? `Hello ${safeName},` : "Hello,";

  const mailFeedbackHref = `mailto:${encodeURIComponent(
    safeSupportEmail
  )}?subject=${encodeURIComponent("Strava Integration Feedback")}`;

  const mailBugHref = `mailto:${encodeURIComponent(
    safeSupportEmail
  )}?subject=${encodeURIComponent("Strava Integration Bug Report")}`;

  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style dangerouslySetInnerHTML={{ __html: darkModeStyles }} />
      </Head>

      <Preview>{`Strava integration is live — fully automated ride importing and bike linking.`}</Preview>

      <Body className="ll-body" style={styles.body}>
        <Container className="ll-container" style={styles.container}>
          <Section style={{ padding: "8px 6px 14px 6px" }}>
            <Text className="ll-brand" style={styles.brand}>
              LoamLogger
            </Text>
          </Section>

          <Section className="ll-card" style={styles.card}>
            <Heading className="ll-h1" style={styles.h1}>
              Strava integration is live for everyone
            </Heading>

            <Text className="ll-p" style={styles.p}>
              {hello}
            </Text>

            <Text className="ll-p" style={styles.p}>
              Strava integration is now available for all Loam Logger users.
              If you use Strava directly, or your device uploads to Strava
              (Garmin, Suunto, COROS, WHOOP, and others), your rides can now flow
              into Loam Logger automatically.
            </Text>

            <Section className="ll-callout" style={styles.callout}>
              <Text className="ll-p" style={{ ...styles.p, margin: 0 }}>
                <span className="ll-emph" style={styles.emph}>
                  The big win:
                </span>
                <br />
                Select the bike you used in Strava and Loam Logger will
                automatically attach that ride to the correct bike — no manual
                cleanup required.
              </Text>
            </Section>

            <Section style={styles.imageContainer}>
              <Img
                src="https://loamlogger.app/LiebWhisRockRoll.jpg"
                alt="Mountain biker riding through lush ferns"
                width="60%"
                style={styles.heroImage}
              />
            </Section>

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              How it works
            </Heading>

            <Text className="ll-bullets" style={styles.bullets}>
              • Connect Strava once in{" "}
              <Link href={safeSettingsUrl} className="ll-link" style={styles.link}>
                Settings → Integrations
              </Link>
            </Text>

            <Text className="ll-bullets" style={styles.bullets}>
              • New rides usually appear in Loam Logger{" "}
              <span className="ll-emph" style={styles.emph}>
                within a few seconds
              </span>{" "}
              after Strava finishes processing the activity
            </Text>

            <Text className="ll-bullets" style={styles.bullets}>
              • If you select the bike you used in Strava, Loam Logger will
              automatically link the ride to that bike
            </Text>

            <Text className="ll-bullets" style={{ ...styles.bullets, paddingLeft: 32 }}>
              – This requires a{" "}
              <span className="ll-emph" style={styles.emph}>
                one-time bike name mapping
              </span>{" "}
              between Strava and Loam Logger
            </Text>

            <Text className="ll-p" style={styles.p}>
              Once mapped, everything is fully automatic — no manual ride editing required.
            </Text>

            <Section style={{ paddingTop: 8, paddingBottom: 12, textAlign: "center" }}>
              <Button href={safeSettingsUrl} className="ll-button" style={styles.button}>
                🔗 Connect Strava
              </Button>
            </Section>

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              Using multiple providers?
            </Heading>

            <Text className="ll-p" style={styles.p}>
              If you import rides from both Garmin and Strava, Loam Logger can
              detect duplicate rides automatically.
              To clean things up, head to{" "}
              <Link href={safeSettingsUrl} className="ll-link" style={styles.link}>
                Settings
              </Link>{" "}
              and run{" "}
              <span className="ll-emph" style={styles.emph}>
                Scan for duplicate rides
              </span>
              .
            </Text>

            <Section className="ll-callout" style={styles.callout}>
              <Text className="ll-p" style={{ ...styles.p, marginBottom: 0 }}>
                Feedback on this integration is especially helpful — edge cases,
                timing issues, or bike matching quirks all help make this better.
              </Text>
            </Section>

            <Section style={{ paddingTop: 8, paddingBottom: 12, textAlign: "center" }}>
              <Button href={mailFeedbackHref} className="ll-button" style={styles.button}>
                💡 Share Feedback
              </Button>
            </Section>

            <Section style={{ paddingBottom: 12, textAlign: "center" }}>
              <Button href={mailBugHref} className="ll-button" style={styles.button}>
                🐛 Report a Bug
              </Button>
            </Section>

            <Text className="ll-p" style={styles.p}>
              This gets Loam Logger much closer to the “set it and forget it”
              experience — ride, sync, and let the system take care of the rest.
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

            <Text className="ll-p" style={{ ...styles.p, marginBottom: 0 }}>
              Loam Labs LLC
            </Text>
          </Section>

          <Section style={styles.footer}>
            <Text className="ll-footer" style={{ ...styles.footerText, marginBottom: 0 }}>
              Loam Logger is a product of Loam Labs LLC. You are receiving this
              because you signed up for beta access.
            </Text>

            {unsubscribeUrl ? (
              <Text className="ll-footer" style={{ ...styles.footerText, marginTop: 6 }}>
                <Link href={unsubscribeUrl} className="ll-footer-link" style={styles.footerLink}>
                  Unsubscribe
                </Link>
              </Text>
            ) : null}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const styles: Record<string, React.CSSProperties> = {
  body: {
    margin: 0,
    padding: 0,
    backgroundColor: TOKENS.bg,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
  },
  container: {
    width: "100%",
    maxWidth: 800,
    margin: "0 auto",
    padding: "22px 14px 28px",
  },
  brand: {
    fontSize: 14,
    letterSpacing: 0.2,
    fontWeight: 800,
    color: TOKENS.text,
    margin: 0,
  },
  card: {
    backgroundColor: TOKENS.card,
    border: `1px solid ${TOKENS.border}`,
    borderRadius: 18,
    padding: "22px 20px",
  },
  h1: {
    fontSize: 22,
    lineHeight: "1.25",
    color: TOKENS.text,
    fontWeight: 800,
    margin: "0 0 12px 0",
  },
  h2: {
    fontSize: 16,
    lineHeight: "1.35",
    color: TOKENS.text,
    fontWeight: 800,
    margin: "0 0 10px 0",
  },
  p: {
    fontSize: 14,
    lineHeight: "1.75",
    color: TOKENS.muted,
    margin: "0 0 12px 0",
  },
  bullets: {
    fontSize: 14,
    lineHeight: "1.75",
    color: TOKENS.muted,
    margin: "0 0 8px 0",
    paddingLeft: 16,
    textIndent: -16,
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
  hr: {
    borderColor: TOKENS.border,
    margin: "14px 0 10px",
  },
  imageContainer: {
    margin: "16px 0",
    textAlign: "center" as const,
  },
  heroImage: {
    borderRadius: 12,
    maxWidth: "100%",
    height: "auto",
    display: "inline-block",
    margin: "0 auto",
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
  footer: {
    padding: "14px 6px 0 6px",
  },
  footerText: {
    fontSize: 11,
    lineHeight: "1.6",
    color: TOKENS.footer,
    margin: 0,
  },
  footerLink: {
    color: TOKENS.faint,
    textDecoration: "underline",
  },
};

/** Template configuration for admin email UI */
export const templateConfig: TemplateConfig = {
  id: "strava-integration-live",
  displayName: "Strava Integration Live",
  description:
    "Announces Strava integration, real-time ride importing, auto bike linking, and duplicate detection",
  defaultSubject: "Strava integration is live for everyone",
  emailType: "strava_integration_live",
  templateVersion: STRAVA_INTEGRATION_LIVE_TEMPLATE_VERSION,
  adminVisible: true,
  parameters: [
    { key: "recipientFirstName", label: "First Name", type: "text", required: false, autoFill: "recipientFirstName" },
    { key: "settingsUrl", label: "Settings URL", type: "url", required: false, defaultValue: "https://loamlogger.app/settings" },
    { key: "supportEmail", label: "Support Email", type: "text", required: false, defaultValue: "ryan.lecours@loamlogger.app" },
    { key: "unsubscribeUrl", label: "Unsubscribe URL", type: "hidden", required: false, autoFill: "unsubscribeUrl" },
  ],
  render: (props) =>
    React.createElement(StravaIntegrationLiveEmail, props as StravaIntegrationLiveEmailProps),
};
