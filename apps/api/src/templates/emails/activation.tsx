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
import { sanitizeUserInput, isValidEmail } from "../../lib/html";

export const ACTIVATION_TEMPLATE_VERSION = "2.3.0";

export type ActivationEmailProps = {
  recipientFirstName?: string;
  email?: string;
  tempPassword?: string;
  loginUrl?: string;
  resetPasswordUrl?: string;
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
    html, body, .ll-body, .ll-container { background-color: ${DARK_TOKENS.bg} !important; }
    .ll-card { background-color: ${DARK_TOKENS.card} !important; border-color: ${DARK_TOKENS.border} !important; }
    .ll-callout { background-color: ${DARK_TOKENS.subCard} !important; border-color: ${DARK_TOKENS.subBorder} !important; }
    .ll-h1, .ll-h2, .ll-emph, .ll-brand, .ll-signature { color: ${DARK_TOKENS.text} !important; }
    .ll-p, .ll-bullets, .ll-link { color: ${DARK_TOKENS.muted} !important; }
    .ll-hr { border-color: ${DARK_TOKENS.border} !important; margin-bottom: 25px !important; }
    .ll-button { background-color: ${DARK_TOKENS.ctaBg} !important; color: ${DARK_TOKENS.ctaText} !important; }
    .ll-footer { color: ${DARK_TOKENS.footer} !important; }
    .ll-footer-link { color: ${DARK_TOKENS.faint} !important; }
    .ll-code { background-color: ${DARK_TOKENS.subCard} !important; border-color: ${DARK_TOKENS.subBorder} !important; color: ${DARK_TOKENS.text} !important; }
    .ll-step { background-color: ${DARK_TOKENS.subCard} !important; border-color: ${DARK_TOKENS.subBorder} !important; }
  }
`;

export default function ActivationEmail({
  recipientFirstName,
  email = "rider@example.com",
  tempPassword = "••••••••",
  loginUrl = "https://loamlogger.app/login",
  resetPasswordUrl,
  appUrl = "https://loamlogger.app",
  spokesUrl = "https://99spokes.com",
  unsubscribeUrl,
}: ActivationEmailProps) {
  const safeName = sanitizeUserInput(recipientFirstName);
  const safeEmail = sanitizeUserInput(email, 254);
  const safeTempPassword = sanitizeUserInput(tempPassword, 64);

  const greeting = safeName ? `Good morning ${safeName},` : "Good morning,";

  const safeResetUrl =
    resetPasswordUrl ??
    (isValidEmail(safeEmail)
      ? `${appUrl.replace(/\/$/, "")}/forgot-password?email=${encodeURIComponent(safeEmail)}`
      : `${appUrl.replace(/\/$/, "")}/forgot-password`);

  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style dangerouslySetInnerHTML={{ __html: darkModeStyles }} />
      </Head>

      <Preview>
        Your Loam Logger access is live — log in, change your password, and connect Garmin, Whoop or Strava.
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
              Your account is live 🎉
            </Heading>

            <Text className="ll-p" style={styles.p}>
              {greeting}
            </Text>

            <Text className="ll-p" style={styles.p}>
              Your <span className="ll-emph" style={styles.emph}>Founding Rider</span> access is now active.
            </Text>

            <Text className="ll-p" style={styles.p}>
              You are one of the first riders shaping Loam Logger. That means full access to everything,
              free for life, and a direct line to influence what this becomes.
            </Text>

            <Img
              src='https://loamlogger.app/ridingThroughFerns.jpg'
              alt="Mountain biker riding through lush ferns on a forest trail"
              width="60%"
              style={styles.heroImage}
            />

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              Your login details
            </Heading>

            <Section className="ll-callout" style={styles.callout}>
              <Text className="ll-p" style={{ ...styles.p, margin: "0 0 8px 0" }}>
                <span className="ll-emph" style={styles.emph}>Email:</span> {safeEmail}
              </Text>

              <Text className="ll-p" style={{ ...styles.p, margin: "0 0 8px 0" }}>
                <span className="ll-emph" style={styles.emph}>Temporary password:</span>{" "}
                <span className="ll-code" style={styles.code}>
                  {safeTempPassword}
                </span>
              </Text>

              <Text className="ll-p" style={{ ...styles.p, margin: 0, fontSize: 12 }}>
                You will be prompted to change this password the first time you log in.
              </Text>
            </Section>

            <Section className="ll-callout" style={{ ...styles.callout, textAlign: "center" }}>
              <Text className="ll-p" style={{ ...styles.p, margin: 0 }}>
                <span className="ll-emph" style={styles.emph}>Log in:</span>{" "}
                <Link href={loginUrl} className="ll-link" style={styles.link}>
                  {loginUrl.replace(/^https?:\/\//, "")}
                </Link>
              </Text>

              <Section style={{ paddingTop: 10, paddingBottom: 6 }}>
                <Button href={loginUrl} className="ll-button" style={styles.button}>
                  Log in to Loam Logger
                </Button>
              </Section>

              <Text className="ll-p" style={{ ...styles.p, margin: "8px 0 0 0", fontSize: 12 }}>
                If the button doesn&apos;t work, copy/paste the link above.
              </Text>
            </Section>

            <Heading as="h2" className="ll-h2" style={{ ...styles.h2, marginTop: 4 }}>
              Recommended first 5 minutes
            </Heading>

            <Section className="ll-step" style={styles.stepCard}>
              <Text className="ll-bullets" style={styles.bullets}>
                • Log in and change your password
              </Text>
              <Text className="ll-bullets" style={styles.bullets}>
                • Add a bike (you can add more later)
              </Text>
              <Text className="ll-bullets" style={styles.bullets}>
                • Connect Garmin, Whoop or Strava to pull your rides automatically
              </Text>
              <Text className="ll-bullets" style={styles.bullets}>
                • Skim the dashboard. It will show what is closest to needing attention
              </Text>
              <Text className="ll-bullets" style={styles.bullets}>
                • Backfill previous rides from Strava or Garmin
              </Text>
            </Section>

            <Text className="ll-p" style={styles.p}>
              There is no perfect setup. Just get it close and we will refine it together.
            </Text>

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              Why Loam Logger Exists
            </Heading>

            <Text className="ll-p" style={styles.p}>
              I began building Loam Logger because there isn't currently a great way to reliably track
              maintenance and servicing across multiple bikes. I have tried
              spreadsheets, notes, mental checklists, and other apps. None of
              them felt trustworthy enough to ride without second-guessing.
            </Text>
            <Section className="ll-callout" style={styles.callout}>
              <Text className="ll-p" style={styles.p}>
                <span className="ll-emph" style={styles.emph}>The goal is simple:</span><br />You should be able to grab your bike after work
                and head out the door with confidence that it is good to go.
              </Text>

            </Section>
            <Img
              src='https://loamlogger.app/dakotaWhis.jpg'
              alt="Mountain biking in Whistler"
              width="60%"
              style={styles.heroImage}
            />
            <Hr className="ll-hr" style={styles.hr} />
            <Heading as="h2" className="ll-h2" style={styles.h2}>
              What Loam Logger Solves
            </Heading>

            <Text className="ll-p" style={styles.p}>
              Loam Logger quietly tracks wear, logs maintenance, and notifies you
              when it's actually time to look at a component. You no longer have
              to keep it all in your head or do the math from your Strava hours.
            </Text>
            <Text className="ll-p" style={styles.p}>
              <span className="ll-emph" style={styles.emph}>Riders will save money</span> by servicing components at the right time, not too early and not too late.</Text>
            <Text className="ll-p" style={styles.p}>
              <span className="ll-emph" style={styles.emph}>For bike and component dealers</span>, Loam Logger provides a way to connect with riders in your area and offer them the right service at the right time. Riders who are in tune with what maintenance their bikes need and when are more likely to get that maintenance done, which means more consistent business for shops and better performing bikes for riders.
            </Text> <Text className="ll-p" style={styles.p}>
              <span className="ll-emph" style={styles.emph}>A true win-win.</span>
            </Text>

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              What is already working
            </Heading>

            <Text className="ll-bullets" style={styles.bullets}>• Automatic ride sync with Garmin, Whoop and Strava</Text>
            <Text className="ll-bullets" style={{ ...styles.bullets, paddingLeft: 32 }}>- Track a ride from your smartwatch or phone like you normally do, those stats are automatically pulled in to Loam Logger.</Text>
            <Text className="ll-bullets" style={styles.bullets}>• Auto-populate bike specs thanks to{" "}
              <Link href={spokesUrl} className="ll-link" style={styles.link}>99spokes.com</Link>
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>• Track 21+ individual components on all of your bikes</Text>
            <Text className="ll-bullets" style={styles.bullets}>• Predictive maintenance analysis</Text>
            <Text className="ll-bullets" style={{ ...styles.bullets, paddingLeft: 32 }}>- "Check your front brake pads in ~4 rides, shock 200hr service should be done in ~9 rides, etc."</Text>
            <Text className="ll-bullets" style={styles.bullets}>• Algorithmic wear tracking</Text>
            <Text className="ll-bullets" style={{ ...styles.bullets, paddingLeft: 32 }}>- Considers elevation change, distance and grade when weighting wear on components</Text>
            <Text className="ll-bullets" style={{ ...styles.bullets, paddingLeft: 32 }}>- For example, the steeper the trail, the more wear and tear on your brake pads and suspension. Shuttling does not wear your drivetrain the way an XC ride will.</Text>
            <Text className="ll-bullets" style={{ ...styles.bullets, paddingLeft: 32 }}>- This algorithm will need tuning to function and feel correct, we'll dial this in together.</Text>
            <Text className="ll-bullets" style={styles.bullets}>• At-a-glance dashboard for bike and component health</Text>
            <Text className="ll-bullets" style={styles.bullets}>• User customizable notifications, service intervals, and wear algorithm parameters</Text>


            <Text className="ll-p" style={styles.p}>(There's much more, but this covers the core idea.)</Text>
            <Hr className="ll-hr" style={styles.hr} />
            <Heading as="h2" className="ll-h2" style={styles.h2}>
              Ideas for the future (Suggested by riders like you)
            </Heading>

            <Text className="ll-bullets" style={styles.bullets}>• Native support for Coros, Suunto, and Apple Watch</Text>
            <Text className="ll-bullets" style={styles.bullets}>• "What's that sound?" bike diagnostic page</Text>
            <Text className="ll-bullets" style={styles.bullets}>• Connecting users to nearby bike shops that can perform the needed service</Text>
            <Text className="ll-bullets" style={styles.bullets}>• Weather API integration - option to factor wet, dry, dusty conditions into wear calculations</Text>
            <Text className="ll-bullets" style={styles.bullets}>• The Beater Board - An opt-in leaderboard celebrating the most neglected / clapped-out bikes</Text>
            <Text className="ll-bullets" style={styles.bullets}>• Any other insightful, fun, funny feature ideas any of you come up with!</Text>

            <Section style={styles.imageContainer}>
              <Img
                src="https://loamlogger.app/RyanAbenaki.jpg"
                alt="Mountain biker riding through lush ferns"
                width="60%"
                style={styles.heroImage}
              />
            </Section>


            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              Quick help
            </Heading>

            <Text className="ll-bullets" style={styles.bullets}>
              • Forgot your password?{" "}
              <Link href={safeResetUrl} className="ll-link" style={styles.link}>
                Reset it here
              </Link>
              .
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • Prefer not to use Loam Logger right now? No worries, you can log in anytime in the next week before your temporary password expires.
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • Founding Riders stay free for life (as long as the account is used in good faith, per the terms at creation).
            </Text>

            <Text className="ll-p" style={{ ...styles.p, marginTop: 14, marginBottom: 0 }}>
              I am excited to see what you think once you get a few rides in.
            </Text>

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
  stepCard: {
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
  code: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    backgroundColor: TOKENS.subCard,
    border: `1px solid ${TOKENS.subBorder}`,
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 13,
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

/**
 * Get the activation email subject line.
 */
export function getActivationEmailSubject(): string {
  return "Your Loam Logger account is live";
}

export type GetActivationEmailHtmlParams = {
  name?: string;
  email: string;
  tempPassword: string;
  loginUrl?: string;
  unsubscribeUrl?: string;
};

/**
 * Render the activation email to HTML string.
 * This is a convenience function for use by the activation service.
 */
export async function getActivationEmailHtml({
  name,
  email,
  tempPassword,
  loginUrl,
  unsubscribeUrl,
}: GetActivationEmailHtmlParams): Promise<string> {
  const element = (
    <ActivationEmail
      recipientFirstName={name}
      email={email}
      tempPassword={tempPassword}
      loginUrl={loginUrl}
      unsubscribeUrl={unsubscribeUrl}
    />
  );

  return render(element);
}