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
import { sanitizeUserInput } from "../../lib/html";

export const WELCOME_1_TEMPLATE_VERSION = "2.2.0";

export type Welcome1EmailProps = {
  recipientFirstName?: string;
  dashboardUrl?: string;
  connectUrl?: string; // optional: direct to integrations/settings page
  supportEmail?: string;
  appUrl?: string;
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

export default function Welcome1Email({
  recipientFirstName,
  dashboardUrl = "https://loamlogger.app/dashboard",
  connectUrl,
  supportEmail = "ryan.lecours@loamlogger.app",
  appUrl = "https://loamlogger.app",
  unsubscribeUrl,
}: Welcome1EmailProps) {
  // Sanitize user-provided input
  const safeName = sanitizeUserInput(recipientFirstName);
  const greeting = safeName ? `Hi ${safeName},` : "Hi there,";

  const safeConnectUrl = connectUrl ?? `${appUrl.replace(/\/$/, "")}/settings/connections`;

  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style dangerouslySetInnerHTML={{ __html: darkModeStyles }} />
      </Head>

      <Preview>3 small steps that make Loam Logger feel “set and forget.”</Preview>

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
              Quick setup, then forget it exists
            </Heading>

            <Text className="ll-p" style={styles.p}>
              {greeting}
            </Text>

            <Text className="ll-p" style={styles.p}>
              You should have received a couple emails already (welcome + activation). Most people skim those — totally
              fair.<br />Here is the simple version of what matters on day one.
            </Text>

            <Section className="ll-callout" style={styles.callout}>
              <Heading as="h2" className="ll-h2" style={styles.h2}>
                The “first 5 minutes” checklist
              </Heading>

              <Text className="ll-bullets" style={styles.bullets}>
                • <span className="ll-emph" style={styles.emph}>Add one bike</span> (the one you ride most).
              </Text>
              <Text className="ll-bullets" style={styles.bullets}>
                • <span className="ll-emph" style={styles.emph}>Connect Garmin or Strava</span> so rides sync automatically.
              </Text>
              <Text className="ll-bullets" style={styles.bullets}>
                • <span className="ll-emph" style={styles.emph}>Ignore perfection</span>. You can fill in details later.
              </Text>

              <Section style={{ paddingTop: 8, paddingBottom: 6, textAlign: "center" }}>
                <Button href={dashboardUrl} className="ll-button" style={styles.button}>
                  Open Loam Logger
                </Button>
              </Section>

              <Text className="ll-p" style={{ ...styles.p, margin: "6px 0 0 0", fontSize: 12, textAlign: "center" }}>
                Want to jump straight to connecting?{" "}
                <Link href={safeConnectUrl} className="ll-link" style={styles.link}>
                  Connect Garmin/Strava
                </Link>
              </Text>
            </Section>

            <Text className="ll-p" style={styles.p}>
              The point of Loam Logger is to act like a mechanic in your pocket: it quietly tracks wear, logs maintenance, and only
              taps you on the shoulder when something is genuinely getting close to needing attention.
            </Text>

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              How to think about the dashboard
            </Heading>

            <Text className="ll-p" style={styles.p}>
              The dashboard is designed to answer one question fast: <span className="ll-emph" style={styles.emph}>“Is my bike good to go?”</span>
            </Text>

            <Text className="ll-p" style={styles.p}>
              You will see components with an estimate like “check in ~4 rides” or “service due in ~9 rides.” Those are
              intentionally conservative early on. The wear algorithm will get better as you (and other riders) poke
              holes in it.
            </Text>

            <Section className="ll-callout" style={styles.callout}>
              <Text className="ll-p" style={{ ...styles.p, margin: 0 }}>
                If something feels wrong (brake pads being “fine forever,” suspension feeling “due immediately,” or a
                ride importing weird), please reply and tell me what you expected. That feedback is gold.
              </Text>

              <Section style={{ paddingTop: 10, textAlign: "center" }}>
                <Button
                  href={`mailto:${supportEmail}?subject=${encodeURIComponent("Loam Logger feedback (welcome)")}`}
                  className="ll-button"
                  style={styles.button}
                >
                  ✉️ Send feedback
                </Button>
              </Section>
            </Section>

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              A small reminder about Founding Riders
            </Heading>

            <Text className="ll-p" style={styles.p}>
              You are marked as a <span className="ll-emph" style={styles.emph}>Founding Rider</span>, which means full access at no cost
              for as long as Loam Logger exists (as long as the account is used in good faith, per the terms at creation).
            </Text>

            <Text className="ll-p" style={{ ...styles.p, marginTop: 14, marginBottom: 0 }}>
              Thanks again for being here. If you do nothing else today: add one bike, connect one service, and go ride.
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
