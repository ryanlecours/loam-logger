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

export const WELCOME_2_TEMPLATE_VERSION = "2.3.0";

export type Welcome2EmailProps = {
  recipientFirstName?: string;
  gearUrl?: string;
  dashboardUrl?: string;
  supportEmail?: string;
  unsubscribeUrl?: string;
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
    .ll-chip { background-color: ${DARK_TOKENS.subCard} !important; border-color: ${DARK_TOKENS.subBorder} !important; color: ${DARK_TOKENS.text} !important; }
  }
`;

export default function Welcome2Email({
  recipientFirstName,
  gearUrl = "https://loamlogger.app/gear",
  dashboardUrl = "https://loamlogger.app/dashboard",
  supportEmail = "ryan.lecours@loamlogger.app",
  unsubscribeUrl,
}: Welcome2EmailProps) {
  const greeting = recipientFirstName ? `Hi ${recipientFirstName},` : "Hi there,";

  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style dangerouslySetInnerHTML={{ __html: darkModeStyles }} />
      </Head>

      <Preview>
        Loam Logger is your mechanic in your pocket — here is how wear tracking works.
      </Preview>

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
              Loam Logger: The Mechanic in your Pocket
            </Heading>

            <Text className="ll-p" style={styles.p}>{greeting}</Text>

            <Text className="ll-p" style={styles.p}>
              Three days in, this is the simplest way to think about Loam Logger:
              <span className="ll-emph" style={styles.emph}> it is a mechanic in your pocket.</span>
            </Text>

            <Section className="ll-callout" style={styles.callout}>
              <Text className="ll-p" style={{ ...styles.p, margin: 0 }}>
                The end-state I am aiming for is you saying:
                <br />
                <span className="ll-emph" style={styles.emph}>
                  “I do not feel the need to track wear or maintenance anymore. Loam Logger does that for me.”
                </span>
              </Text>
            </Section>

            <Text className="ll-p" style={styles.p}>
              Not to nag you. Not to add chores. Just to make it easy to answer one question:
            </Text>

            <Text className="ll-p" style={styles.p}>
              <span className="ll-emph" style={styles.emph}> “Is my bike all set to ride?”</span>
            </Text>

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              What you should be able to trust
            </Heading>

            <Text className="ll-bullets" style={styles.bullets}>
              • <span className="ll-emph" style={styles.emph}>Confidence:</span> your bike is ready right now.
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • <span className="ll-emph" style={styles.emph}>Runway:</span> how long until something needs attention.
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • <span className="ll-emph" style={styles.emph}>Early warnings:</span> before small issues become expensive.
            </Text>

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              What Loam Logger is doing behind the scenes
            </Heading>

            <Text className="ll-p" style={styles.p}>
              Each ride adds wear to different components. Loam Logger weighs rides using signals like
              distance, elevation change. Not all rides stress your bike the same way.
            </Text>

            <Text className="ll-p" style={styles.p}>
              That is why guidance shows up as{" "}
              <span className="ll-emph" style={styles.emph}>“check this in ~X rides”</span>{" "}
              instead of raw hour math.
            </Text>

            {/* NEW SECTION */}
            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              Seeing wear, ride by ride
            </Heading>

            <Text className="ll-p" style={styles.p}>
              You can click into any component directly from the dashboard to see how individual rides
              are contributing wear to it.
            </Text>

            <Section className="ll-callout" style={styles.callout}>
              <Text className="ll-p" style={{ ...styles.p, margin: 0 }}>
                Not all rides stress your bike the same way.
                <br /><br />
                • A bike park day should not wear your drivetrain like an XC race.
                <br />
                • A gravel path ride does not stress suspension and pivot bearings like a steep, chunky tech trail.
              </Text>
            </Section>

            <Text className="ll-p" style={styles.p}>
              That difference is exactly what the wear algorithm is trying to capture.
            </Text>

            <Text className="ll-p" style={styles.p}>
              Clicking into a component lets you sanity-check the logic.
            </Text>

            <Text className="ll-p" style={styles.p}>
              <span className="ll-emph" style={styles.emph}>
                “Yeah, that ride should have hit my brakes harder than my chain.”
              </span>
            </Text>

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              If something feels off, tell me in one sentence (or more, more is better)
            </Heading>

            <Text className="ll-p" style={styles.p}>
              The most helpful feedback is exactly your opinion of how the app should behave:
              <span className="ll-emph" style={styles.emph}> bike + component + expectation</span>.
            </Text>

            <Section style={{ paddingTop: 8, paddingBottom: 12, textAlign: "center" }}>
              <Button
                href={`mailto:${supportEmail}?subject=${encodeURIComponent(
                  "Loam Logger wear feedback"
                )}`}
                className="ll-button"
                style={styles.button}
              >
                ✉️ Send feedback
              </Button>
            </Section>

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              Where to check things
            </Heading>

            <Text className="ll-p" style={styles.p}>
              For a quick answer, the dashboard is the simplest view.
              If you ever want details or tuning controls, that’s what the Gear section is for.
            </Text>

            <Section style={{ paddingTop: 8, textAlign: "center" }}>
              <Button href={dashboardUrl} className="ll-button" style={styles.button}>
                Open the dashboard
              </Button>
            </Section>

            <Text className="ll-p" style={{ ...styles.p, textAlign: "center" }}>
              Or dive deeper in{" "}
              <Link href={gearUrl} className="ll-link" style={styles.link}>
                Gear
              </Link>
              .
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
              Loam Logger • You&apos;re receiving this because you signed up for early access.
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
