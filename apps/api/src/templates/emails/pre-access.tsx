import * as React from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { sanitizeUserInput } from "../../lib/html";

export const FOUNDING_RIDERS_LAUNCH_TEMPLATE_VERSION = "1.0.0";

export type FoundingRidersLaunchEmailProps = {
  recipientFirstName?: string;
  appUrl?: string;
  spokesUrl?: string;
  unsubscribeUrl?: string;
  supportEmail?: string;
};

const TOKENS = {
  // Light mode (default)
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
  // Dark mode
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

export default function FoundingRidersLaunchEmail({
  recipientFirstName,
  appUrl = "https://loamlogger.app",
  spokesUrl = "https://99spokes.com",
  unsubscribeUrl,
  supportEmail = "ryan.lecours@loamlogger.app",
}: FoundingRidersLaunchEmailProps) {
  const safeName = sanitizeUserInput(recipientFirstName);
  const safeAppUrl = sanitizeUserInput(appUrl, 200);
  const safeSpokesUrl = sanitizeUserInput(spokesUrl, 200);
  const safeSupportEmail = sanitizeUserInput(supportEmail, 200);

  const hello = safeName ? `Hello ${safeName},` : "Hello,";

  const mailIdeaHref = `mailto:${encodeURIComponent(
    safeSupportEmail
  )}?subject=${encodeURIComponent("Loam Logger Feedback")}`;

  const mailBugHref = `mailto:${encodeURIComponent(
    safeSupportEmail
  )}?subject=${encodeURIComponent("Loam Logger Bug Report")}`;

  const mailShareHref = `mailto:?subject=${encodeURIComponent(
    "Loam Logger"
  )}&body=${encodeURIComponent(
    `I thought you might be interested in this bike maintenance app: ${safeAppUrl}`
  )}`;

  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style dangerouslySetInnerHTML={{ __html: darkModeStyles }} />
      </Head>

      <Preview>{`Your Founding Rider access to Loam Logger opens today.`}</Preview>

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
              Founding Riders access to Loam Logger opens today
            </Heading>

            <Text className="ll-p" style={styles.p}>
              {hello}
            </Text>

            <Text className="ll-p" style={styles.p}>
              Today I am opening Loam Logger to you and the rest of the Founding
              Riders.
            </Text>

            <Text className="ll-p" style={styles.p}>
              My goal with Loam Logger is simple: help you get out of work, get
              on your bike, and feel confident that your bike is good to go,
              without having to think too hard about it.
            </Text>

            <Text className="ll-p" style={styles.p}>
              Later today, you will receive a second email with your login
              details, including a temporary password that you will reset on
              first login. From there, the app should do most of the explaining
              on its own.
            </Text>

            {/* Quick callout */}
            <Section className="ll-callout" style={styles.callout}>
              <Text className="ll-p" style={{ ...styles.p, margin: 0 }}>
                <span className="ll-emph" style={styles.emph}>
                  The goal is simple:
                </span>
                <br />
                You should be able to grab your bike after work and head out the
                door with confidence that it is good to go.
              </Text>
            </Section>

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              What is ready right now
            </Heading>

            <Text className="ll-bullets" style={styles.bullets}>
              • Track all of your bikes in one place, including bike importing
              from{" "}
              <Link href={safeSpokesUrl} className="ll-link" style={styles.link}>
                99spokes.com
              </Link>
            </Text>

            <Text className="ll-bullets" style={styles.bullets}>
              • Basic hour tracking with set service intervals for a familiar,
              conventional maintenance experience
            </Text>

            <Text className="ll-bullets" style={styles.bullets}>
              • Automatic ride importing from Garmin, including backfilled rides
            </Text>

            <Text className="ll-bullets" style={styles.bullets}>
              • Ride stats across multiple timeframes such as year to date, last
              year, and recent
            </Text>

            <Text className="ll-bullets" style={styles.bullets}>
              • A unified view of rides from multiple data providers as they
              become available
            </Text>

            <Text className="ll-bullets" style={styles.bullets}>
              • Access to the <span className="ll-emph" style={styles.emph}>predictive maintenance algorithm</span>
            </Text>

            <Text className="ll-bullets" style={{ ...styles.bullets, paddingLeft: 32 }}>
              - Accounts for XC rides versus steep enduro trails versus road or commute miles
            </Text>

            <Text className="ll-bullets" style={{ ...styles.bullets, paddingLeft: 32 }}>
              - Weights wear differently across components
            </Text>

            <Text className="ll-bullets" style={{ ...styles.bullets, paddingLeft: 32 }}>
              - Estimates how many rides you likely have left before a component deserves attention
            </Text>

            <Section className="ll-callout" style={styles.callout}>
              <Text className="ll-p" style={{ ...styles.p, marginBottom: 0 }}>
                A quick note on the predictive side: <span className="ll-emph" style={styles.emph}>I believe this will be a
                real advantage long term</span>, especially for privateers and riders
                who log a lot of varied terrain, but it needs more real world
                data to reach true accuracy.
              </Text>
              <Text className="ll-p" style={{ ...styles.p, marginTop: 10, marginBottom: 0 }}>
                <span className="ll-emph" style={styles.emph}>
                  Your usage and feedback here directly shape where this goes.
                </span>
              </Text>
            </Section>

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              A small beta reality check
            </Heading>

            <Text className="ll-p" style={styles.p}>
              Strava has currently limited me to a single athlete connection
              while they review the app. I have already requested additional
              access and I expect <span className="ll-emph" style={styles.emph}>Strava connections to open up in the next five
              to seven days</span>. I will email you as soon as it is ready.
            </Text>

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              What is coming soon
            </Heading>

            <Text className="ll-bullets" style={styles.bullets}>
              • Front and rear brake, rotor, and tire tracking (five to seven
              days)
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • COROS, Suunto, and WHOOP integrations (next two weeks)
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • Weather data integration (around three weeks)
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • Suspension bracketing and setup notes (mid to late February)
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • iOS and Android apps (late February)
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • Bike issue diagnostic wizard (April or May)
            </Text>

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              How you can shape this
            </Heading>

            <Text className="ll-p" style={styles.p}>
              I have already received some great ideas, including comparing
              performance when running different components on the same bike.
              One example is coil versus air shock performance on the same
              trail. These problems come with real complexity, including setup
              differences, riding style, and day to day energy, but I believe
              there is enough signal to make something genuinely useful over
              time.
            </Text>

            <Text className="ll-p" style={styles.p}>
              The biggest thing I need from you is simple: go ride. Tell me what
              feels sticky, confusing, missing, or unintuitive, and what you
              wish the app did better. Whatever you give me is what I will
              focus on.
            </Text>

            <Section style={{ paddingTop: 8, paddingBottom: 12, textAlign: "center" }}>
              <Button href={mailIdeaHref} className="ll-button" style={styles.button}>
                💡 Share Feedback
              </Button>
            </Section>

            <Text className="ll-p" style={styles.p}>
              If you find a bug or something feels off, that is just as valuable
              as feature ideas.
            </Text>

            <Section style={{ paddingBottom: 12, textAlign: "center" }}>
              <Button href={mailBugHref} className="ll-button" style={styles.button}>
                🐛 Report a Bug
              </Button>
            </Section>

            <Text className="ll-p" style={styles.p}>
              If you have friends who care deeply about their bikes and would
              enjoy contributing ideas, you can share{" "}
              <Link href={safeAppUrl} className="ll-link" style={styles.link}>
                loamlogger.app
              </Link>{" "}
              with them.
            </Text>

            <Section style={{ paddingBottom: 12, textAlign: "center" }}>
              <Button href={mailShareHref} className="ll-button" style={styles.button}>
                🔗 Share Loam Logger
              </Button>
            </Section>


            <Text className="ll-p" style={styles.p}>
              That's all I have for this update. Hope to catch you out on the trails, and excited to hear how Loam Logger helps you ride more and worry less!
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
              Ryan
            </Text>
          </Section>

          {/* Footer */}
          <Section style={styles.footer}>
            <Text className="ll-footer" style={{ ...styles.footerText, marginBottom: 0 }}>
              Loam Logger • You are receiving this because you signed up for beta access.
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
