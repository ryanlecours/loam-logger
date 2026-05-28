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
  Img,
} from "@react-email/components";
import { render } from "@react-email/render";
import { sanitizeUserInput } from "../../lib/html";
import type { TemplateConfig } from "./types";

export const FOUNDING_RIDER_UPGRADE_TEMPLATE_VERSION = "1.0.0";

const DEFAULT_APP_STORE_URL = "https://apps.apple.com/us/app/loam-logger/id6761736134";

export type FoundingRiderUpgradeEmailProps = {
  recipientFirstName?: string;
  /** Apple App Store listing, used for both the rating and share CTAs. */
  appStoreUrl?: string;
  unsubscribeUrl?: string;
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

export default function FoundingRiderUpgradeEmail({
  recipientFirstName,
  appStoreUrl = DEFAULT_APP_STORE_URL,
  unsubscribeUrl,
}: FoundingRiderUpgradeEmailProps) {
  const safeName = sanitizeUserInput(recipientFirstName);
  const greeting = safeName ? `Hey ${safeName},` : "Hey there,";

  const shareUrl = `mailto:?subject=${encodeURIComponent(
    "Check out Loam Logger",
  )}&body=${encodeURIComponent(
    `I've been using Loam Logger to track my bike maintenance. Thought you might like it: ${appStoreUrl}`,
  )}`;

  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style dangerouslySetInnerHTML={{ __html: darkModeStyles }} />
      </Head>
      <Preview>You&apos;re now a Loam Logger Founding Rider with full access, free for life.</Preview>

      <Body className="ll-body" style={styles.body}>
        <Container className="ll-container" style={styles.container}>
          {/* Brand */}
          <Section style={{ padding: "8px 6px 14px 6px" }}>
            <Text className="ll-brand" style={styles.brand}>
              LoamLogger
            </Text>
          </Section>

          {/* Main Card */}
          <Section className="ll-card" style={styles.card}>
            <Heading className="ll-h1" style={styles.h1}>
              You&apos;re a Founding Rider 🎉
            </Heading>

            <Text className="ll-p" style={styles.p}>{greeting}</Text>

            <Text className="ll-p" style={styles.p}>
              I&apos;ve just upgraded your account to{" "}
              <span className="ll-emph" style={styles.emph}>Founding Rider</span>. Welcome aboard, and
              thank you for being one of the early riders shaping where this goes.
            </Text>

            <Section style={styles.imageContainer}>
              <Img
                src="https://loamlogger.app/IngridLoam.jpg"
                alt="Mountain biker railing a loamy corner"
                width="92%"
                style={styles.heroImage}
              />
            </Section>

            {/* What founding-rider status means */}
            <Heading as="h2" className="ll-h2" style={styles.h2}>
              What that means for you
            </Heading>

            <Text className="ll-p" style={styles.p}>
              Founding Rider is the highest tier in Loam Logger, and it&apos;s yours{" "}
              <span className="ll-emph" style={styles.emph}>free for life</span>*. No subscription, no
              tiers to weigh, nothing locked behind a paywall. Every feature, current and future, is
              already turned on for your account:
            </Text>

            <Text className="ll-bullets" style={styles.bullets}>
              • <span className="ll-emph" style={styles.emph}>Automatic ride sync</span> from Garmin,
              Strava, Whoop, and Suunto. Log a ride the way you already do and it flows straight in
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • <span className="ll-emph" style={styles.emph}>Track 21+ components</span> across every
              bike in your garage, with specs auto-filled via 99spokes
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • <span className="ll-emph" style={styles.emph}>Predictive maintenance</span>: &quot;check
              your front brake pads in ~4 rides, shock service in ~9&quot; instead of guessing
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • <span className="ll-emph" style={styles.emph}>Algorithmic wear tracking</span> that
              weighs distance, elevation, and grade. A steep shuttle day and an XC grind wear your
              bike differently, and Loam Logger knows it
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • <span className="ll-emph" style={styles.emph}>An at-a-glance dashboard</span> for bike
              and component health, plus fully customizable notifications, service intervals, and wear
              parameters
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • <span className="ll-emph" style={styles.emph}>Shareable ride-stat exports</span> with no
              map or GPS data, so you can post a season recap without broadcasting where you ride
            </Text>

            <Text className="ll-p" style={styles.p}>
              In short: grab your bike after work and head out the door knowing it&apos;s dialed.
            </Text>

            <Section style={styles.imageContainer}>
              <Img
                src="https://loamlogger.app/RyanAbenaki.jpg"
                alt="Mountain biker on a forested trail"
                width="58%"
                style={styles.heroImage}
              />
            </Section>

            <Text className="ll-p" style={styles.p}>
              A few things would genuinely help in return, in order of how much they&apos;d mean to me.
            </Text>

            {/* 1. Feedback (top priority) */}
            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              1. Tell me what you think (this matters most)
            </Heading>

            <Text className="ll-p" style={styles.p}>
              The single most valuable thing you can do is share your honest feedback. What feels great,
              what&apos;s confusing, what&apos;s missing, any bugs or rough edges. Big ideas and small
              annoyances are equally welcome. Just reply to this email; it comes straight to me.
            </Text>

            <Section className="ll-callout" style={{ ...styles.callout, textAlign: "center" }}>
              <Button
                href="mailto:ryan.lecours@loamlogger.app?subject=Loam%20Logger%20Feedback"
                className="ll-button"
                style={styles.button}
              >
                💬 Share Feedback
              </Button>
            </Section>

            {/* 2. Share with friends */}
            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              2. Share it with riding friends
            </Heading>

            <Text className="ll-p" style={styles.p}>
              If you know someone who cares about their bikes, or who hates keeping track of
              maintenance, send them to{" "}
              <Link href={appStoreUrl} className="ll-link" style={styles.link}>
                Loam Logger on the App Store
              </Link>
              . Word of mouth from riders like you is how this grows.
            </Text>

            <Section className="ll-callout" style={{ ...styles.callout, textAlign: "center" }}>
              <Button href={shareUrl} className="ll-button" style={styles.button}>
                🔗 Share Loam Logger
              </Button>
            </Section>

            <Section style={styles.imageContainer}>
              <Img
                src="https://loamlogger.app/TommyBermGap.jpg"
                alt="Rider gapping into a bermed corner"
                width="58%"
                style={styles.heroImage}
              />
            </Section>

            {/* 3. Rate on the App Store */}
            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              3. Rate the app, if you&apos;re enjoying it
            </Heading>

            <Text className="ll-p" style={styles.p}>
              A rating on the App Store goes a long way toward helping Loam Logger get discovered by
              other riders. If the app has been useful, a few seconds here makes a real difference.
            </Text>

            <Section className="ll-callout" style={{ ...styles.callout, textAlign: "center" }}>
              <Button href={appStoreUrl} className="ll-button" style={styles.button}>
                ⭐ Rate on the App Store
              </Button>
            </Section>

            <Text className="ll-p" style={{ ...styles.p, fontSize: 12 }}>
              On Android? The Android app is coming soon. I&apos;ll let you know the moment it&apos;s live.
            </Text>

            <Section style={styles.imageContainer}>
              <Img
                src="https://loamlogger.app/LiebWhisRockRoll.jpg"
                alt="Rider rolling a rock slab in Whistler"
                width="58%"
                style={styles.heroImage}
              />
            </Section>

            <Text className="ll-p" style={{ ...styles.p, marginTop: 14, marginBottom: 0 }}>
              Thanks again for being here early and opinionated. Excited to keep building this with you.
            </Text>

            <Text
              className="ll-signature"
              style={{
                ...styles.p,
                marginTop: 10,
                marginBottom: 0,
                color: TOKENS.text,
                fontWeight: 800,
              }}
            >
              – Ryan
            </Text>
          </Section>

          {/* Footer */}
          <Section style={styles.footer}>
            <Text className="ll-footer" style={{ ...styles.footerText, marginBottom: 0 }}>
              Loam Logger is a product of Loam Labs LLC.
            </Text>
            <Text className="ll-footer" style={{ ...styles.footerText, marginTop: 6, fontStyle: "italic" }}>
              * As long as the account is used in good faith and in line with the terms at creation.
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
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
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
    textAlign: "center",
  },
  heroImage: {
    borderRadius: 12,
    maxWidth: "100%",
    height: "auto",
    display: "block",
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

/** Subject line for the founding-rider upgrade email. */
export function getFoundingRiderUpgradeEmailSubject(): string {
  return "You're a Loam Logger Founding Rider";
}

/** Template configuration for admin email UI (also sendable manually). */
export const templateConfig: TemplateConfig = {
  id: "founding-rider-upgrade",
  displayName: "Founding Rider Upgrade",
  description:
    "Sent when an admin upgrades an account to founding rider: welcome + feedback ask + share + App Store rating.",
  defaultSubject: getFoundingRiderUpgradeEmailSubject(),
  emailType: "upgrade_confirmation",
  templateVersion: FOUNDING_RIDER_UPGRADE_TEMPLATE_VERSION,
  adminVisible: true,
  parameters: [
    { key: "recipientFirstName", label: "First Name", type: "text", required: false, autoFill: "recipientFirstName" },
    { key: "appStoreUrl", label: "App Store URL", type: "url", required: false, defaultValue: DEFAULT_APP_STORE_URL },
    { key: "unsubscribeUrl", label: "Unsubscribe URL", type: "hidden", required: false, autoFill: "unsubscribeUrl" },
  ],
  render: (props) => React.createElement(FoundingRiderUpgradeEmail, props as FoundingRiderUpgradeEmailProps),
};

/** Render the founding-rider upgrade email to an HTML string. */
export async function getFoundingRiderUpgradeEmailHtml(
  props: FoundingRiderUpgradeEmailProps,
): Promise<string> {
  return render(React.createElement(FoundingRiderUpgradeEmail, props));
}
