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

export const FOUNDING_RIDERS_TEMPLATE_VERSION = "1.1.0";

export type FoundingRidersEmailProps = {
  recipientFirstName?: string;
  activationDateText?: string;
  appUrl?: string;
  spokesUrl?: string;
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
    body { background-color: ${DARK_TOKENS.bg} !important; }
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

export default function FoundingRidersEmail({
  recipientFirstName,
  activationDateText = "January 21, 2026",
  appUrl = "https://loamlogger.app",
  spokesUrl = "https://99spokes.com",
  unsubscribeUrl,
}: FoundingRidersEmailProps) {
  const hello = recipientFirstName ? `Good morning ${recipientFirstName},` : "Good morning,";

  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style dangerouslySetInnerHTML={{ __html: darkModeStyles }} />
      </Head>
      <Preview>{`Your Loam Logger access goes live ${activationDateText}.`}</Preview>

      <Body style={styles.body}>
        <Container style={styles.container}>
          {/* Brand */}
          <Section style={{ padding: "8px 6px 14px 6px" }}>
            <Text className="ll-brand" style={styles.brand}>
              LoamLogger
            </Text>
          </Section>

          {/* Main Card */}
          <Section className="ll-card" style={styles.card}>
            <Heading className="ll-h1" style={styles.h1}>
              Thank you and welcome, Founding Riders
            </Heading>

            <Text className="ll-p" style={styles.p}>{hello}</Text>

            <Text className="ll-p" style={styles.p}>
              Welcome to <span className="ll-emph" style={styles.emph}>Loam Logger</span>.</Text>

            <Text className="ll-p" style={styles.p}>
              I genuinely appreciate you signing up to be among
              the very first users of{" "}
              Loam Logger. Spending time with an
              early product and sharing honest feedback is not something I take
              lightly.
            </Text>

            <Text className="ll-p" style={styles.p}>
              As a thank-you, your account is designated as a{"  "}
              <span className="ll-emph" style={styles.emph}>Founding Rider</span>, which means
              complete access of all features at no cost for as long as Loam Logger exists,
              as long as the account is used in good faith and in line with the
              terms at creation.
            </Text>

            {/* Activation Callout */}
            <Section className="ll-callout" style={styles.callout}>
              <Text className="ll-p" style={{ ...styles.p, margin: 0, textAlign: 'center' }}>
                <span className="ll-emph" style={styles.emph}>Accounts go live:</span>{" "}
                {activationDateText}.
              </Text>

              <Text className="ll-p" style={styles.p}>Between now and then, I'd love to gather
                ideas and feedback before you even log your first ride.
              </Text>
            </Section>

            <Hr className="ll-hr" style={styles.hr} />

            {/* Why */}
            <Heading as="h2" className="ll-h2" style={styles.h2}>
              Why I'm Building Loam Logger
            </Heading>

            <Text className="ll-p" style={styles.p}>
              At its core,
              Loam Logger is a safety net for bike maintenance.
            </Text>

            <Text className="ll-p" style={styles.p}>
              I began building it because there isn't currently a great way to reliably track
              maintenance and servicing across multiple bikes. I have tried
              spreadsheets, notes, mental checklists, and other apps. None of
              them felt trustworthy enough to ride without second-guessing.
            </Text>
            <Section className="ll-callout" style={styles.callout}>
              <Text className="ll-p" style={styles.p}>
                <span className="ll-emph" style={styles.emph}>The goal is simple:</span><br />You should be able to grab your bike after work
                and head out the door with confidence that it's good to go.
              </Text>
            </Section>

            <Text className="ll-p" style={styles.p}>
              Loam Logger quietly tracks wear, logs maintenance, and notifies you
              when it's actually time to look at a component. You no longer have
              to keep it all in your head or do the math from your Strava hours.
            </Text>

            <Text className="ll-p" style={styles.p}>
              I have built Loam Logger entirely from the ground up, purely with code. That
              gives us a lot of flexibility, but it also means there will be some
              bugs and rough edges early on. Your help spotting those is just as
              valuable as feature ideas.</Text>

            <Text className="ll-p" style={styles.p}>
              Even these emails are custom coded. Let me know if anything looks weird on your end.
            </Text>

            <Hr className="ll-hr" style={styles.hr} />

            {/* What's Ready (High Level) */}
            <Heading as="h2" className="ll-h2" style={styles.h2}>
              What's Ready Now (High Level)
            </Heading>

            <Text className="ll-bullets" style={styles.bullets}>• Automatic ride sync with Garmin and Strava</Text>
            <Text className="ll-bullets" style={styles.bullets}>• Auto-populate bike specs via{" "}
              <Link href={spokesUrl} className="ll-link" style={styles.link}>99spokes.com</Link>
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>• Track 21+ individual components on all of your bikes</Text>
            <Text className="ll-bullets" style={styles.bullets}>• Predictive maintenance analysis - "Check your front brake pads in ~4 rides, shock 200hr service should be done in ~9 rides, etc."</Text>
            <Text className="ll-bullets" style={styles.bullets}>• Algorithmic wear tracking considers elevation change, distance and grade when weighting wear on components</Text>
            <Text className="ll-bullets" style={styles.bullets}>• At-a-glance dashboard for bike and component health</Text>
            <Text className="ll-bullets" style={styles.bullets}>• User customizable notifications, service intervals, and wear algorithm parameters</Text>

            <Text className="ll-p" style={styles.p}>(There's much more, but this covers the core idea.)</Text>

            <Hr className="ll-hr" style={styles.hr} />

            {/* What's Ready (High Level) */}
            <Heading as="h2" className="ll-h2" style={styles.h2}>
              Ideas for the future (Suggested by friends!)
            </Heading>

            <Text className="ll-bullets" style={styles.bullets}>• Native support for Coros, Suunto, eventually Whoop and Apple Watch</Text>
            <Text className="ll-bullets" style={styles.bullets}>• "What's that sound?" bike diagnostic page</Text>
            <Text className="ll-bullets" style={styles.bullets}>• Connecting users to nearby bike shops that can perform the needed service</Text>
            <Text className="ll-bullets" style={styles.bullets}>• Weather API integration - option to factor wet, dry, dusty conditions into wear calculations</Text>
            <Text className="ll-bullets" style={styles.bullets}>• The Beater Board - An opt-in leaderboard celebrating the most neglected / clapped-out bikes</Text>
            <Text className="ll-bullets" style={styles.bullets}>• Any other insightful, fun, funny feature ideas any of you come up with!</Text>

            <Hr className="ll-hr" style={styles.hr} />

            {/* CTA */}
            <Heading as="h2" className="ll-h2" style={styles.h2}>
              How You Can Shape This
            </Heading>

            <Text className="ll-bullets" style={styles.bullets}>• "If Strava did this, it would be perfect"</Text>
            <Text className="ll-bullets" style={styles.bullets}>• "If Trailforks handled that, I'd use it more"</Text>
            <Text className="ll-bullets" style={styles.bullets}>• "I wish I could track X on my bike"</Text>
            <Text className="ll-bullets" style={styles.bullets}>• "This would make bike maintenance less daunting"</Text>

            <Text className="ll-p" style={styles.p}>
              Big ideas, small annoyances, half-baked thoughts are all welcome.
              Reply to this email, message me on instagram, stop me if you see me around Bellingham,
              reach out however works for you.
            </Text>

            <Section style={{ paddingTop: 8, paddingBottom: 6, textAlign: 'center' }}>
              <Button
                href={`mailto:ryan.lecours@loamlogger.app?subject=Loam%20Logger%20Idea`}
                className="ll-button"
                style={styles.button}
              >
                💡 Share an Idea
              </Button>
            </Section>

            <Text className="ll-p" style={styles.p}>
              If you have friends who care deeply about their bikes, or if those friends have a deep hatred for maintaining their bike, and would
              enjoy contributing ideas, feel free to share this link with them.
            </Text>

            <Section style={{ paddingTop: 4, paddingBottom: 6, textAlign: 'center' }}>
              <Button
                href={`mailto:?subject=Check%20out%20Loam%20Logger&body=I%20thought%20you%20might%20be%20interested%20in%20this%20bike%20maintenance%20app%3A%20${encodeURIComponent(appUrl)}`}
                className="ll-button"
                style={styles.button}
              >
                🔗 Share Loam Logger
              </Button>
            </Section>
            {/* Launch timing */}
            <Text className="ll-p" style={styles.p}>
              My goal is to get something genuinely useful into the hands of friends in the bike community for the start of the season.{" "}
              <span className="ll-emph" style={styles.emph}>Loam Logger will launch publicly as a website application in late April 2026</span>,
              with <span className="ll-emph" style={styles.emph}>iOS and Android apps to follow</span> as soon as I can after the public launch.
            </Text>

            <Text className="ll-p" style={{ ...styles.p, marginTop: 14, marginBottom: 0 }}>
              Thank you again for being early, patient, and opinionated. I am
              excited to build this with you all.
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
              Loam Logger • You're receiving this because you signed up for beta
              access.
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
