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

export const BETA_FEATURE_ROUNDUP_TEMPLATE_VERSION = "1.0.1";

export type BetaFeatureRoundupEmailProps = {
  recipientFirstName?: string;

  settingsUrl?: string;
  integrationsUrl?: string;
  servicePrefsUrl?: string;
  ridesUrl?: string;
  gearUrl?: string;

  unsubscribeUrl?: string;
  supportEmail?: string;

  heroImageUrl?: string;
  heroImageAlt?: string;

  // Second image, intended for an Integrations screenshot or UI capture
  image2Url?: string;
  image2Alt?: string;
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

export default function BetaFeatureRoundupEmail({
  recipientFirstName,
  settingsUrl = "https://loamlogger.app/settings",
  integrationsUrl = "https://loamlogger.app/settings#integrations",
  servicePrefsUrl = "https://loamlogger.app/settings#service-tracking",
  ridesUrl = "https://loamlogger.app/rides",
  gearUrl = "https://loamlogger.app/gear",
  unsubscribeUrl,
  supportEmail = "ryan.lecours@loamlogger.app",
  heroImageUrl = "https://loamlogger.app/RyanAbenaki.jpg",
  heroImageAlt = "Mountain biker riding on a forest trail",
  image2Url = "https://loamlogger.app/TommyBermGap.jpg",
  image2Alt = "Mountain Biker gapping a bermed turn on a trail",
}: BetaFeatureRoundupEmailProps) {
  const safeName = sanitizeUserInput(recipientFirstName);
  const safeSupportEmail = sanitizeUserInput(supportEmail, 200);

  const safeSettingsUrl = sanitizeUserInput(settingsUrl, 200);
  const safeIntegrationsUrl = sanitizeUserInput(integrationsUrl, 200);
  const safeServicePrefsUrl = sanitizeUserInput(servicePrefsUrl, 200);
  const safeRidesUrl = sanitizeUserInput(ridesUrl, 200);
  const safeGearUrl = sanitizeUserInput(gearUrl, 200);

  const safeHeroImageUrl = heroImageUrl
    ? sanitizeUserInput(heroImageUrl, 500)
    : undefined;

  const safeImage2Url = image2Url ? sanitizeUserInput(image2Url, 500) : undefined;

  const hello = safeName ? `Hello ${safeName},` : "Hello,";

  const mailFeedbackHref = `mailto:${encodeURIComponent(
    safeSupportEmail
  )}?subject=${encodeURIComponent("Loam Logger Beta Feedback")}`;

  const mailBugHref = `mailto:${encodeURIComponent(
    safeSupportEmail
  )}?subject=${encodeURIComponent("Loam Logger Bug Report")}`;

  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style dangerouslySetInnerHTML={{ __html: darkModeStyles }} />
      </Head>

      <Preview>
        New in Loam Logger: WHOOP, service preferences, front and rear tracking,
        and major rides and gear upgrades.
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
              Beta feature roundup: smarter service tracking, WHOOP integration,
              and what comes next
            </Heading>

            <Text className="ll-p" style={styles.p}>
              {hello}
            </Text>

            <Text className="ll-p" style={styles.p}>
              Here is a roundup of what has landed in Loam Logger since the last
              Strava update in late January. This release focuses on reducing
              manual work while giving you more control over how your bikes and
              components are tracked.
            </Text>

            <Section className="ll-callout" style={styles.callout}>
              <Text className="ll-p" style={{ ...styles.p, margin: 0 }}>
                <span className="ll-emph" style={styles.emph}>
                  The biggest addition:
                </span>
                <br />
                You can now configure service tracking globally and override it
                per bike, including custom service intervals and tracking
                toggles.
              </Text>
            </Section>

            {safeHeroImageUrl ? (
              <Section style={styles.imageContainer}>
                <Img
                  src={safeHeroImageUrl}
                  alt={heroImageAlt}
                  width="60%"
                  style={styles.heroImage}
                />
              </Section>
            ) : null}

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              Service tracking preferences
            </Heading>

            <Text className="ll-bullets" style={styles.bullets}>
              • Configure global service preferences in{" "}
              <Link href={safeServicePrefsUrl} className="ll-link" style={styles.link}>
                Settings
              </Link>
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • Override intervals and tracking behavior on individual bikes
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • Enable or disable tracking per component type and define custom
              service hour intervals
            </Text>

            <Section className="ll-callout" style={styles.callout}>
              <Text className="ll-p" style={{ ...styles.p, marginBottom: 0 }}>
                <span className="ll-emph" style={styles.emph}>Example use case:</span>{" "}
                You want your enduro bike to flag suspension service sooner than your trail bike,
                and you do not want to track chain service on your winter commuter setup.
              </Text>
            </Section>

            <Section style={{ paddingTop: 8, paddingBottom: 12, textAlign: "center" }}>
              <Button href={safeServicePrefsUrl} className="ll-button" style={styles.button}>
                ⚙️ Review Service Preferences
              </Button>
            </Section>

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              WHOOP integration
            </Heading>

            <Text className="ll-bullets" style={styles.bullets}>
              • Connect your WHOOP account and sync cycling activities
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • Import historical rides using activity backfill
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • New rides sync automatically through real time webhooks
            </Text>

            <Text className="ll-p" style={styles.p}>
              If you use more than one data provider, Loam Logger automatically
              detects duplicate rides so activities are not counted twice.
            </Text>

            <Section className="ll-callout" style={styles.callout}>
              <Text className="ll-p" style={{ ...styles.p, marginBottom: 0 }}>
                <span className="ll-emph" style={styles.emph}>Example use case:</span>{" "}
                You ride with WHOOP and your friend tags a group ride on Strava. Both imports can happen,
                but Loam Logger keeps one clean copy so your bike hours stay accurate.
              </Text>
            </Section>

            <Section style={{ paddingTop: 8, paddingBottom: 12, textAlign: "center" }}>
              <Button href={safeIntegrationsUrl} className="ll-button" style={styles.button}>
                🔌 Manage Integrations
              </Button>
            </Section>

            {/* Second image goes here to break up the text after the Integrations CTA */}
            {safeImage2Url ? (
              <Section style={styles.imageContainer}>
                <Img
                  src={safeImage2Url}
                  alt={image2Alt}
                  width="70%"
                  style={styles.heroImage}
                />
              </Section>
            ) : null}

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              Front and rear component tracking
            </Heading>

            <Text className="ll-bullets" style={styles.bullets}>
              • Tires, brake pads, rotors, and brake fluid are now tracked
              separately for front and rear
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • Existing components were migrated automatically with a one time
              notice
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • Clearer labels such as Front Brake Fluid and Rear Tire
            </Text>

            <Section className="ll-callout" style={styles.callout}>
              <Text className="ll-p" style={{ ...styles.p, marginBottom: 0 }}>
                <span className="ll-emph" style={styles.emph}>Example use case:</span>{" "}
                You burn rear pads twice as fast as front pads. Now your rear pad service alerts can trigger earlier
                without bothering you about the front.
              </Text>
            </Section>

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              Rides and stats improvements
            </Heading>

            <Text className="ll-bullets" style={styles.bullets}>
              • Bulk select rides and assign them to a bike in one action
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • Filter ride statistics by a specific bike or view all bikes
              combined
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • Improved timeframe selection and more reliable stat calculations
            </Text>

            <Section className="ll-callout" style={styles.callout}>
              <Text className="ll-p" style={{ ...styles.p, marginBottom: 0 }}>
                <span className="ll-emph" style={styles.emph}>Example use case:</span>{" "}
                You forgot to pick a bike in Strava for a week. Select those rides in Loam Logger and assign them to
                your enduro bike in one shot. Then filter stats to verify that bike hours look right.
              </Text>
            </Section>

            <Section style={{ paddingTop: 8, paddingBottom: 12, textAlign: "center" }}>
              <Button href={safeRidesUrl} className="ll-button" style={styles.button}>
                📊 Open Rides
              </Button>
            </Section>

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              Gear page updates and custom snooze durations
            </Heading>

            <Text className="ll-bullets" style={styles.bullets}>
              • Cleaner gear layout and improved component detail rows
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • Service alerts now support custom snooze durations in hours
            </Text>

            <Section className="ll-callout" style={styles.callout}>
              <Text className="ll-p" style={{ ...styles.p, marginBottom: 0 }}>
                <span className="ll-emph" style={styles.emph}>Example use case:</span>{" "}
                Your bottom bracket is starting to creak, but it still feels fine for now.
                Snooze the inspection for 25 hours, then check it again after a few more rides.
              </Text>
            </Section>

            <Section style={{ paddingTop: 8, paddingBottom: 12, textAlign: "center" }}>
              <Button href={safeGearUrl} className="ll-button" style={styles.button}>
                🧰 Open Gear
              </Button>
            </Section>

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              What is coming next: custom builds and component swapping
            </Heading>

            <Text className="ll-p" style={styles.p}>
              Several beta testers have asked about better support for custom
              built bikes and for moving components between bikes over time.
              This is the next major area of focus.
            </Text>

            <Text className="ll-bullets" style={styles.bullets}>
              • First class support for custom built bikes
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • Ability to move components between bikes while preserving
              service history
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • Smarter handling of shared or rotated components such as
              wheelsets and drivetrains
            </Text>

            <Section className="ll-callout" style={styles.callout}>
              <Text className="ll-p" style={{ ...styles.p, marginBottom: 0 }}>
                <span className="ll-emph" style={styles.emph}>Example use case:</span>{" "}
                You move a wheelset from your trail bike to your race bike for the season.
                Loam Logger should carry the wheel and hub service history with it, while bike level hours remain separate.
              </Text>
            </Section>

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              Mobile experience improvements
            </Heading>

            <Text className="ll-p" style={styles.p}>
              Layout and interaction improvements across Dashboard, Bike Detail,
              and Gear pages make the app smoother and easier to use on smaller
              screens.
            </Text>

            <Section className="ll-callout" style={styles.callout}>
              <Text className="ll-p" style={{ ...styles.p, marginBottom: 0 }}>
                If anything feels off, including missing data, duplicate rides,
                or post migration issues, please reach out. Screenshots are very
                helpful.
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
              Thanks again for being part of the beta. Your real world usage is
              directly shaping where this product goes next.
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
              email because you signed up for beta access.
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

export const templateConfig: TemplateConfig = {
  id: "beta-feature-roundup",
  displayName: "Beta Feature Roundup",
  description:
    "Summary of beta features added since late January, including WHOOP integration, service preferences, front and rear component tracking, rides and gear improvements, and upcoming custom build support",
  defaultSubject:
    "Loam Logger beta updates: smarter service tracking, WHOOP, and what comes next",
  emailType: "beta_feature_roundup",
  templateVersion: BETA_FEATURE_ROUNDUP_TEMPLATE_VERSION,
  adminVisible: true,
  parameters: [
    {
      key: "recipientFirstName",
      label: "First Name",
      type: "text",
      required: false,
      autoFill: "recipientFirstName",
    },
    {
      key: "settingsUrl",
      label: "Settings URL",
      type: "url",
      required: false,
      defaultValue: "https://loamlogger.app/settings",
    },
    {
      key: "integrationsUrl",
      label: "Integrations URL",
      type: "url",
      required: false,
      defaultValue: "https://loamlogger.app/settings#integrations",
    },
    {
      key: "servicePrefsUrl",
      label: "Service Preferences URL",
      type: "url",
      required: false,
      defaultValue: "https://loamlogger.app/settings#service-tracking",
    },
    {
      key: "ridesUrl",
      label: "Rides URL",
      type: "url",
      required: false,
      defaultValue: "https://loamlogger.app/rides",
    },
    {
      key: "gearUrl",
      label: "Gear URL",
      type: "url",
      required: false,
      defaultValue: "https://loamlogger.app/gear",
    },
    {
      key: "supportEmail",
      label: "Support Email",
      type: "text",
      required: false,
      defaultValue: "ryan.lecours@loamlogger.app",
    },
    {
      key: "heroImageUrl",
      label: "Hero Image URL",
      type: "url",
      required: false,
    },
    {
      key: "heroImageAlt",
      label: "Hero Image Alt",
      type: "text",
      required: false,
      defaultValue: "Mountain biker riding on a forest trail",
    },
    {
      key: "image2Url",
      label: "Second Image URL",
      type: "url",
      required: false,
    },
    {
      key: "image2Alt",
      label: "Second Image Alt",
      type: "text",
      required: false,
      defaultValue: "Loam Logger integrations screen showing connected providers",
    },
    {
      key: "unsubscribeUrl",
      label: "Unsubscribe URL",
      type: "hidden",
      required: false,
      autoFill: "unsubscribeUrl",
    },
  ],
  render: (props) =>
    React.createElement(BetaFeatureRoundupEmail, props as BetaFeatureRoundupEmailProps),
};
