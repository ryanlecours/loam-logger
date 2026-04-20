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
import type { TemplateConfig } from "./types";

export const APRIL_2026_UPDATE_TEMPLATE_VERSION = "1.0.0";

export type FoundingRidersAprilUpdateProps = {
  recipientFirstName?: string;
  appUrl?: string;
  testflightUrl?: string;
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

export default function FoundingRidersAprilUpdateEmail({
  recipientFirstName,
  appUrl = "https://loamlogger.app",
  testflightUrl = "https://testflight.apple.com/join/YOUR_CODE",
  unsubscribeUrl,
}: FoundingRidersAprilUpdateProps) {
  const safeName = sanitizeUserInput(recipientFirstName);
  const hello = safeName ? `Good morning ${safeName},` : "Good morning,";

  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style dangerouslySetInnerHTML={{ __html: darkModeStyles }} />
      </Head>
      <Preview>
        New timeline view, PDF export, and a fix for the stock-component dates that were all piled up on the day you added your bike.
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
              A big bike history update
            </Heading>

            <Text className="ll-p" style={styles.p}>{hello}</Text>

            <Text className="ll-p" style={styles.p}>
              Quick update from my end. A pretty big batch of bike-history work shipped this week,
              both on the web app and the TestFlight build, and most of what's below came directly
              from feedback a few of you sent after logging your first rides. Wanted to walk you
              through it properly.
            </Text>

            <Hr className="ll-hr" style={styles.hr} />

            {/* Section 1: Bike History timeline */}
            <Heading as="h2" className="ll-h2" style={styles.h2}>
              Bike History timeline
            </Heading>

            <Text className="ll-p" style={styles.p}>
              Every ride, service log, and component install or removal on a bike, grouped by year,
              on one screen. Open any bike and tap{" "}
              <span className="ll-emph" style={styles.emph}>View Full History</span>.
            </Text>

            <Text className="ll-bullets" style={styles.bullets}>
              • Filter by timeframe (30 days, 90 days, 1 year, or all time)
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • Toggle rides and service events independently
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • Tap any service or install row to edit or delete it
            </Text>

            <Section className="ll-callout" style={styles.callout}>
              <Text className="ll-p" style={{ ...styles.p, margin: 0 }}>
                This is the view I kept wishing for while reconstructing my own bikes' service
                history from fourteen different places. One screen, chronological, complete.
              </Text>
            </Section>

            <Hr className="ll-hr" style={styles.hr} />

            {/* Section 2: Share as PDF */}
            <Heading as="h2" className="ll-h2" style={styles.h2}>
              Share as PDF
            </Heading>

            <Text className="ll-p" style={styles.p}>
              Tap the share icon in the history header to export a formatted PDF of the whole
              bike. This is the document you want to bring with you.
            </Text>

            <Text className="ll-p" style={styles.p}>
              <span className="ll-emph" style={styles.emph}>Selling the bike?</span>{" "}
              A buyer who can see every ride, every service, and every component swap trusts the
              asking price. A detailed maintenance record is one of the biggest differentiators
              between a bike that sells fast at your number and one that sits on Pinkbike for
              three months.
            </Text>

            <Text className="ll-p" style={styles.p}>
              <span className="ll-emph" style={styles.emph}>Taking it to a new mechanic or shop?</span>{" "}
              Hand them the PDF and skip the "so, uh, I think I last replaced the brake pads
              in..." conversation. They see exactly what's been done, when, and in what order.
              Faster diagnosis, fewer surprises on the invoice.
            </Text>

            <Text className="ll-p" style={styles.p}>
              Also useful as backup for warranty questions or just a personal archive. Worth
              saying plainly: it's a helpful supporting record, not formal proof. Hang onto your
              shop receipts for anything a manufacturer or insurer wants to verify. The PDF
              respects your current timeframe filter, so you can export "this season only" or
              "everything since day one."
            </Text>

            <Hr className="ll-hr" style={styles.hr} />

            {/* Section 3: Fixing the install-date pile-up */}
            <Heading as="h2" className="ll-h2" style={styles.h2}>
              Fixing the install-date pile-up (the important one)
            </Heading>

            <Section className="ll-callout" style={styles.callout}>
              <Text className="ll-p" style={{ ...styles.p, margin: 0 }}>
                Say you got your bike back in 2024 but only added it to Loam Logger in 2026. The
                bike history would show your bike and every stock component as installed in
                2026, the day you set things up in the app, instead of 2024 when you actually got
                it. Two years of real history collapsed onto sign-up day.
              </Text>
            </Section>

            <Text className="ll-p" style={styles.p}>
              Bikes added from today onward prompt you for the actual acquisition date up front,
              so this won't happen going forward. For the bikes you've already added, two new
              tools fix the dates retroactively, depending on how surgical you want to be.
            </Text>

            <Text className="ll-p" style={styles.p}>
              Want to check first? Open any bike's full history and you can see its acquisition
              date right there. If it matches sign-up day instead of when you actually got the
              bike, one of the fixes below is for you.
            </Text>

            <Text className="ll-p" style={styles.p}>
              <span className="ll-emph" style={styles.emph}>Fast path: the "Update Acquisition Date" button.</span>{" "}
              Lives on bike detail, next to Log Service. Pick the real date you got the bike,
              optionally cascade that date to every stock install, confirm. One tap handles the
              common case.
            </Text>

            <Text className="ll-p" style={styles.p}>
              <span className="ll-emph" style={styles.emph}>Power path: multi-select on Bike History.</span>{" "}
              Tap the calendar icon in the history header to enter selection mode, tick specific
              install rows, pick a date, apply. Handles edge cases the fast path can't, like a
              bunch of same-day swaps or fixing just one component.
            </Text>

            <Text className="ll-p" style={styles.p}>
              Both tools also move the underlying service-log "anchors" the wear-prediction engine
              uses, so your prediction math stays honest after you correct dates.
            </Text>

            <Hr className="ll-hr" style={styles.hr} />

            {/* Section: Login touchups */}
            <Heading as="h2" className="ll-h2" style={styles.h2}>
              Login touchups
            </Heading>

            <Text className="ll-p" style={styles.p}>
              Couple more improvements worth flagging.{" "}
              <span className="ll-emph" style={styles.emph}>Apple Sign-In and Face ID</span> both
              shipped, so you can skip the password on every open.
            </Text>

            <Text className="ll-p" style={styles.p}>
              One rough edge I know about: the Terms of Service screen still flashes briefly
              right after login on occasion. I am currently working on it. The good news is it no
              longer shows up every time you open the app, which it used to. Full fix coming soon.
            </Text>

            <Hr className="ll-hr" style={styles.hr} />

            {/* Section 4: Small fixes */}
            <Heading as="h2" className="ll-h2" style={styles.h2}>
              Small fixes bundled in
            </Heading>

            <Text className="ll-bullets" style={styles.bullets}>
              • Edit and delete for individual service logs and install events, via the per-event
              edit sheet
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • Android: the service-log edit sheet no longer leaves a stuck backdrop on some
              devices
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • Date edits near midnight no longer shift by a day (timezone-anchor fix)
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • A few polish items on the bike-history layout
            </Text>

            <Hr className="ll-hr" style={styles.hr} />

            {/* Section: On the horizon + help grow the test group */}
            <Heading as="h2" className="ll-h2" style={styles.h2}>
              On the horizon, and a favor
            </Heading>

            <Text className="ll-p" style={styles.p}>
              <span className="ll-emph" style={styles.emph}>Android beta is cleared to go live.</span>{" "}
              Every approval the Play Store wanted is signed off, so the Android build should
              land for Founding Riders very soon. I'll send the install link the moment it's
              ready.
            </Text>

            <Text className="ll-p" style={styles.p}>
              While we're on the topic of testing: the iOS TestFlight build still has plenty of
              open tester slots. If you know friends who are deep into bikes and would enjoy
              poking at an early-stage app with you, I'd love your help growing the group.
              Forward them the link below.
            </Text>

            <Section style={{ paddingTop: 8, paddingBottom: 12, textAlign: "center" }}>
              <Button href={testflightUrl} className="ll-button" style={styles.button}>
                Share the TestFlight link
              </Button>
            </Section>

            <Hr className="ll-hr" style={styles.hr} />

            {/* Section 5: What I'd love from you */}
            <Heading as="h2" className="ll-h2" style={styles.h2}>
              What I'd love from you
            </Heading>

            <Text className="ll-bullets" style={styles.bullets}>
              • Try the acquisition-date flow on at least one bike you've owned for a while. Does
              the cascade grab what you expected?
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • Export a PDF of one of your bikes. Does the layout read well on your phone or
              printer?
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • If any bike's history still looks weird after the fix, send a screenshot and I'll
              dig in.
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • Feature ideas always welcome.
            </Text>

            <Section style={{ paddingTop: 8, paddingBottom: 6, textAlign: "center" }}>
              <Button href={appUrl} className="ll-button" style={styles.button}>
                Open Loam Logger
              </Button>
            </Section>

            <Section style={{ paddingBottom: 12, textAlign: "center" }}>
              <Button
                href="mailto:ryan.lecours@loamlogger.app?subject=Bike%20history%20feedback"
                className="ll-button"
                style={styles.button}
              >
                Reply with Feedback
              </Button>
            </Section>

            <Hr className="ll-hr" style={styles.hr} />

            <Text className="ll-p" style={styles.p}>
              Thank you again for being early, patient, and{" "}
              <span className="ll-emph" style={styles.emph}>opinionated</span>. Every one of these
              features started as something one of you mentioned.
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
              Loam Logger • You're receiving this because you're a Founding Rider.
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

/** Template configuration for admin email UI */
export const templateConfig: TemplateConfig = {
  id: "founding-riders-april-2026",
  displayName: "Founding Riders: April 2026 Update",
  description:
    "Founder-voice update email covering Bike History timeline, PDF export, and the retroactive acquisition-date fix",
  defaultSubject: "A bigger bike-history update, and a thank-you for testing",
  emailType: "founding_post_activation_info",
  templateVersion: APRIL_2026_UPDATE_TEMPLATE_VERSION,
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
      key: "appUrl",
      label: "App URL",
      type: "url",
      required: false,
      defaultValue: "${FRONTEND_URL}",
    },
    {
      key: "testflightUrl",
      label: "TestFlight Invite URL",
      type: "url",
      required: false,
      defaultValue: "https://testflight.apple.com/join/YOUR_CODE",
      helpText: "Public TestFlight invite link. Replace YOUR_CODE with the join code.",
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
    React.createElement(
      FoundingRidersAprilUpdateEmail,
      props as FoundingRidersAprilUpdateProps
    ),
};
