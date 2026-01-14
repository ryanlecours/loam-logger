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
import { render } from "@react-email/render";
import { sanitizeUserInput, isValidEmail } from "../../lib/html";

export const ACTIVATION_TEMPLATE_VERSION = "2.2.0";

export type ActivationEmailProps = {
  recipientFirstName?: string;
  email?: string;
  tempPassword?: string;
  loginUrl?: string;
  resetPasswordUrl?: string;
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
  supportEmail = "ryan.lecours@loamlogger.app",
  appUrl = "https://loamlogger.app",
  unsubscribeUrl,
}: ActivationEmailProps) {
  // Sanitize user-provided inputs
  const safeName = sanitizeUserInput(recipientFirstName);
  const safeEmail = sanitizeUserInput(email, 254); // Max email length per RFC
  const safeTempPassword = sanitizeUserInput(tempPassword, 64);

  const greeting = safeName ? `Good morning ${safeName},` : "Good morning,";

  // Only include email in reset URL if it's a valid format
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

      <Preview>Your Loam Logger access is live — log in, change your password, and connect Garmin or Strava.</Preview>

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
              Your account is live 🎉
            </Heading>

            <Text className="ll-p" style={styles.p}>
              {greeting}
            </Text>

            <Text className="ll-p" style={styles.p}>
              Your <span className="ll-emph" style={styles.emph}>Founding Rider</span> access is now active.
              Thank you again for being early, patient, and opinionated. You are helping set the direction of this entire platform.
            </Text>

            
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

            <Hr className="ll-hr" style={styles.hr} />

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
                • Connect Garmin or Strava to pull your rides automatically
              </Text>
              <Text className="ll-bullets" style={styles.bullets}>
                • Skim the dashboard. It will show what is closest to needing attention
              </Text>
              <Text className="ll-bullets" style={styles.bullets}>
                • Backfill previous rides from Strava or Garmin
              </Text>
            </Section>

            <Text className="ll-p" style={styles.p}>
              There is no “perfect setup” — just get it roughly feeling right and we will refine together as the wear algorithm gets tuned.
            </Text>

            <Section className="ll-callout" style={{ ...styles.callout, textAlign: "center" }}>
              <Text className="ll-p" style={{ ...styles.p, margin: "0 0 10px 0" }}>
                If anything looks off (wrong components, weird ride data, bugs, etc.), hit reply.
              </Text>

              <Button
                href={`mailto:${supportEmail}?subject=${encodeURIComponent("Loam Logger Feedback / Bug")}`}
                className="ll-button"
                style={styles.button}
              >
                ✉️ Reply with feedback
              </Button>
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
              Loam Logger • You&apos;re receiving this email because you signed up for early access.
            </Text>

            <Text className="ll-footer" style={{ ...styles.footerText, marginTop: 6, fontStyle: "italic" }}>
              If this landed in your inbox by mistake, feel free to ignore it.
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

// Helper type for the legacy getActivationEmailHtml function
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
