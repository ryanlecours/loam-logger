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

export const WELCOME_3_TEMPLATE_VERSION = "2.1.0";

export type Welcome3EmailProps = {
  recipientFirstName?: string;
  settingsUrl?: string;
  dashboardUrl?: string;
  gearUrl?: string;
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

export default function Welcome3Email({
  recipientFirstName,
  settingsUrl = "https://loamlogger.app/settings",
  dashboardUrl = "https://loamlogger.app/dashboard",
  gearUrl = "https://loamlogger.app/gear",
  supportEmail = "ryan.lecours@loamlogger.app",
  unsubscribeUrl,
}: Welcome3EmailProps) {
  const greeting = recipientFirstName ? `Hi ${recipientFirstName},` : "Hi there,";

  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style dangerouslySetInnerHTML={{ __html: darkModeStyles }} />
      </Head>

      <Preview>One week in: quick knobs to customize, then I’ll get out of the way.</Preview>

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
              One week in — a quick closing note
            </Heading>

            <Text className="ll-p" style={styles.p}>
              {greeting}
            </Text>

            <Text className="ll-p" style={styles.p}>
              This is the last onboarding email from me. After this, Loam Logger should quietly do its job in the
              background and stay out of your way.
            </Text>

            <Text className="ll-p" style={styles.p}>
              Some riders dive in immediately. Others will not touch anything until a creak, a squeal, or a service comes
              due. Both are normal — and honestly, the second one is the behavior I am designing for.
            </Text>

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              3 settings that make it feel more “you”
            </Heading>

            <Text className="ll-p" style={styles.p}>
              If you have 60 seconds, these are the only knobs worth looking at:
            </Text>

            <Section className="ll-callout" style={styles.callout}>
              <Text className="ll-bullets" style={styles.bullets}>
                • <span className="ll-emph" style={styles.emph}>Notifications:</span> how noisy (or quiet) Loam Logger should be.
              </Text>
              <Text className="ll-bullets" style={styles.bullets}>
                • <span className="ll-emph" style={styles.emph}>Service intervals:</span> if your preferences differ from defaults.
              </Text>
              <Text className="ll-bullets" style={styles.bullets}>
                • <span className="ll-emph" style={styles.emph}>Connected accounts:</span> connect Garmin/Strava if you have not yet.
              </Text>
            </Section>

            <Section style={{ paddingTop: 8, paddingBottom: 12, textAlign: "center" }}>
              <Button href={settingsUrl} className="ll-button" style={styles.button}>
                Open settings
              </Button>
            </Section>

            <Text className="ll-p" style={styles.p}>
              If you already did all this, you can ignore the above and go ride. Seriously.
            </Text>

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              Where to go when something feels off
            </Heading>

            <Text className="ll-p" style={styles.p}>
              If the dashboard feels “too optimistic” (or “way too alarmist”), it’s almost always fixable.
            </Text>
            
            <Text className="ll-p" style={styles.p}>
              Your gut feeling is the best signal I can get right now.
            </Text>

            <Section className="ll-callout" style={styles.callout}>
              <Text className="ll-p" style={{ ...styles.p, margin: 0 }}>
                The most helpful feedback is simple:
                <br />
                <span className="ll-emph" style={styles.emph}>bike + component + what you expected</span>.
                <br />
                One sentence is enough.
              </Text>

              <Section style={{ paddingTop: 10, textAlign: "center" }}>
                <Button
                  href={`mailto:${supportEmail}?subject=${encodeURIComponent("Loam Logger feedback (week 1)")}`}
                  className="ll-button"
                  style={styles.button}
                >
                  ✉️ Reply with feedback
                </Button>
              </Section>
            </Section>

            <Text className="ll-p" style={styles.p}>
              Quick links (in case they’re handy):
            </Text>

            <Text className="ll-bullets" style={styles.bullets}>
              • <Link href={dashboardUrl} className="ll-link" style={styles.link}>Dashboard</Link>
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • <Link href={gearUrl} className="ll-link" style={styles.link}>Gear</Link>
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • <Link href={settingsUrl} className="ll-link" style={styles.link}>Settings</Link>
            </Text>

            <Text className="ll-p" style={{ ...styles.p, marginTop: 14, marginBottom: 0 }}>
              Thanks again for being part of the early group. Founding Riders like you are the reason this is fun to
              build.
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
