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

export const MAY_2026_UPDATE_TEMPLATE_VERSION = "1.0.0";

export type FoundingRidersMayUpdateProps = {
  recipientFirstName?: string;
  appUrl?: string;
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

export default function FoundingRidersMayUpdateEmail({
  recipientFirstName,
  appUrl = "https://loamlogger.app",
  unsubscribeUrl,
}: FoundingRidersMayUpdateProps) {
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
        May 12 is slipping while Apple finishes pre-launch review, but Suunto support, smarter sync notifications, Face ID, ride-stat exports, and a heat-map safety nudge are all live in TestFlight.
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
              A launch update, Suunto support, and protecting your trails.
            </Heading>

            <Text className="ll-p" style={styles.p}>{hello}</Text>

            <Text className="ll-p" style={styles.p}>
              A quick update. The May 12 App Store launch is slipping. The good news is that
              quite a lot has shipped into TestFlight while I work through Apple&apos;s feedback,
              so if you&apos;re already testing on iOS, most of what&apos;s below is on your
              phone right now.
            </Text>

            <Hr className="ll-hr" style={styles.hr} />

            {/* Section 1: Launch update */}
            <Heading as="h2" className="ll-h2" style={styles.h2}>
              Launch update: May 12 is slipping
            </Heading>

            <Text className="ll-p" style={styles.p}>
              Apple&apos;s pre-launch review came back with a handful of changes they want
              addressed before the App Store listing goes live. Nothing major, mostly compliance
              and polish, but enough that pushing the listing on May 12 isn&apos;t the right call.
              I&apos;m working through their list.
            </Text>

            <Text className="ll-p" style={styles.p}>
              I don&apos;t want to throw out a new date until I&apos;m confident in it. The moment
              the App Store listing goes live, you&apos;ll get an email. The TestFlight build is
              current with everything below, so the testing window just got a bit longer.
            </Text>

            <Hr className="ll-hr" style={styles.hr} />

            {/* Section 2: Suunto */}
            <Heading as="h2" className="ll-h2" style={styles.h2}>
              Suunto integration is complete
            </Heading>

            <Text className="ll-p" style={styles.p}>
              If you ride with a Suunto watch, the app now does everything for you that Garmin,
              Strava, and Whoop already did. Connect once from Settings, your rides flow in
              automatically, gear assignment works the same way, and the wear-prediction engine
              treats Suunto rides like any other source.
            </Text>

            <Text className="ll-p" style={styles.p}>
              If you were waiting on Suunto support, you&apos;re good to go.
            </Text>

            <Hr className="ll-hr" style={styles.hr} />

            {/* Section 3: Smarter ride-sync notifications */}
            <Heading as="h2" className="ll-h2" style={styles.h2}>
              Smarter ride-sync notifications
            </Heading>

            <Text className="ll-p" style={styles.p}>
              New rides now sync to Loam Logger automatically no matter where they came from
              (Garmin, Suunto, Whoop, or Strava), and you get an iOS notification the moment a
              ride lands. No more opening the app to check whether yesterday&apos;s ride imported.
            </Text>

            <Text className="ll-p" style={styles.p}>
              If the app can&apos;t auto-assign a bike to the ride, usually because you own more
              than one and the data provider didn&apos;t tag the gear, the notification itself
              shows a bike picker. One tap from the lockscreen and the ride is assigned. No more
              opening the app, finding the ride, and updating it manually.
            </Text>

            <Hr className="ll-hr" style={styles.hr} />

            {/* Section 4: Face ID / Touch ID */}
            <Heading as="h2" className="ll-h2" style={styles.h2}>
              Face ID and Touch ID login
            </Heading>

            <Text className="ll-p" style={styles.p}>
              Opt in once from Settings and biometric unlock takes over when you open the app.
              Face ID prompts, you&apos;re in. No password on every launch. Works the same way
              on older devices with Touch ID.
            </Text>

            <Text className="ll-p" style={styles.p}>
              This also tidied up a couple of cold-boot issues some of you reported, so even
              without biometrics, opening the app should feel a bit faster.
            </Text>

            <Hr className="ll-hr" style={styles.hr} />

            {/* Section 5: Ride-stat exports */}
            <Heading as="h2" className="ll-h2" style={styles.h2}>
              Ride-stat exports
            </Heading>

            <Text className="ll-p" style={styles.p}>
              You can now pull ride stats out of the app, either for a single ride or any
              timeframe (7-day, 30-day, YTD, previous year, custom range). Distance, elevation
              gain, hours, and average heart rate, all in one block.
            </Text>

            <Text className="ll-p" style={styles.p}>
              Copy the numbers to your clipboard, or export them as a PNG overlay made for
              social sharing. The overlay has no map data, no GPS, and no location. Just the
              numbers, so you can post a season recap without giving away where you ride.
            </Text>

            <Section className="ll-callout" style={styles.callout}>
              <Text className="ll-p" style={{ ...styles.p, margin: 0 }}>
                If you&apos;ve been wanting to share a big week or a year-end total without
                broadcasting where you ride, this is the format. Try it on a 30-day window, see
                how the layout looks, and let me know what&apos;s missing.
              </Text>
            </Section>

            <Hr className="ll-hr" style={styles.hr} />

            {/* Section 6: Heat-map safety ask */}
            <Heading as="h2" className="ll-h2" style={styles.h2}>
              A safety ask: heat-map contributions
            </Heading>

            <Text className="ll-p" style={styles.p}>
              One more thing, and this one matters.
            </Text>

            <Text className="ll-p" style={styles.p}>
              Most data providers (Strava, Garmin, Whoop, Suunto) contribute your rides to a
              public heat map by default. Those heat maps can reveal where you live, what time
              you tend to leave the house, and the exact lines of trails that may be on private
              land, on someone&apos;s property, or otherwise not meant to be public.
            </Text>

            <Text className="ll-p" style={styles.p}>
              This isn&apos;t only about personal safety. A lot of the trails we love exist
              because landowners and trail builders trust the community not to advertise them.
              The fastest way for a private-land trail or a fragile network to get shut down is
              for it to show up as a bright line on a public heat map.
            </Text>

            <Text className="ll-p" style={styles.p}>
              To help with this, every connected data provider in the app now surfaces a safety
              acknowledgement with the exact steps to disable heat-map contribution for that
              specific service. You&apos;ll see it the next time you open the app. It takes
              about 90 seconds per provider, and the acknowledgement only fires once. I won&apos;t
              keep nagging.
            </Text>

            <Hr className="ll-hr" style={styles.hr} />

            {/* Section 7: Where we are */}
            <Heading as="h2" className="ll-h2" style={styles.h2}>
              Where we are
            </Heading>

            <Text className="ll-p" style={styles.p}>
              To recap: the App Store listing is the only thing not live. Everything above is
              shipping in TestFlight right now. I&apos;m working on Apple&apos;s feedback and
              will send the launch confirmation the moment the listing goes live. Thanks for the
              patience while this wraps up. You&apos;re testing the build that becomes v1, so
              anything you flag in the meantime ends up in what new users see on day one.
            </Text>

            <Section style={{ paddingTop: 8, paddingBottom: 6, textAlign: "center" }}>
              <Button href={appUrl} className="ll-button" style={styles.button}>
                Open Loam Logger
              </Button>
            </Section>

            <Section style={{ paddingBottom: 12, textAlign: "center" }}>
              <Button
                href="mailto:ryan.lecours@loamlogger.app?subject=May%20update%20feedback"
                className="ll-button"
                style={styles.button}
              >
                Reply with Feedback
              </Button>
            </Section>

            <Hr className="ll-hr" style={styles.hr} />

            <Text className="ll-p" style={styles.p}>
              Thanks for being patient through the launch wait, and thanks in advance for taking
              the heat-map step seriously. Both of those matter a lot.
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
              Loam Logger • You&apos;re receiving this because you&apos;re a Founding Rider.
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
  id: "founding-riders-may-2026",
  displayName: "Founding Riders: May 2026 Update",
  description:
    "Founder-voice update covering the iOS launch delay (Apple pre-launch feedback), Suunto integration, consolidated ride-sync notifications with one-tap bike assignment, Face ID / Touch ID login, ride-stat exports, and the heat-map safety acknowledgement.",
  defaultSubject: "A launch update, Suunto support, and protecting your trails",
  emailType: "founding_post_activation_info",
  templateVersion: MAY_2026_UPDATE_TEMPLATE_VERSION,
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
      key: "unsubscribeUrl",
      label: "Unsubscribe URL",
      type: "hidden",
      required: false,
      autoFill: "unsubscribeUrl",
    },
  ],
  render: (props) =>
    React.createElement(
      FoundingRidersMayUpdateEmail,
      props as FoundingRidersMayUpdateProps
    ),
};
