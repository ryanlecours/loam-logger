import * as React from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { sanitizeUserInput } from "../../lib/html";
import { TOKENS, darkModeStyles } from "./shared-styles";
import type { TemplateConfig } from "./types";

export const MOBILE_APP_LAUNCH_TEMPLATE_VERSION = "1.0.0";

export type MobileAppLaunchEmailProps = {
  recipientFirstName?: string;
  testflightUrl?: string;
  dashboardUrl?: string;
  unsubscribeUrl?: string;
  supportEmail?: string;
  heroImageUrl?: string;
  heroImageAlt?: string;
  image2Url?: string;
  image2Alt?: string;
};

export default function MobileAppLaunchEmail({
  recipientFirstName,
  testflightUrl = "https://testflight.apple.com/join/K5UWHpQT",
  dashboardUrl = "https://loamlogger.app/",
  unsubscribeUrl,
  supportEmail = "ryan.lecours@loamlogger.app",
  heroImageUrl = "https://loamlogger.app/JohnyZinks.jpg",
  heroImageAlt = "Johny flatspins a jump at the Zink Invitational",
  image2Url = "https://loamlogger.app/BarbLegacyDrop.jpg",
  image2Alt = "Barb drops over the Legacy ATV rig",
}: MobileAppLaunchEmailProps) {
  const safeName = sanitizeUserInput(recipientFirstName);
  const safeSupportEmail = sanitizeUserInput(supportEmail, 200);
  const safeTestflightUrl = sanitizeUserInput(testflightUrl, 500);
  const safeDashboardUrl = sanitizeUserInput(dashboardUrl, 200);
  const safeHeroImageUrl = heroImageUrl ? sanitizeUserInput(heroImageUrl, 500) : undefined;
  const safeImage2Url = image2Url ? sanitizeUserInput(image2Url, 500) : undefined;

  const hello = safeName ? `${safeName},` : "Hey,";

  const mailFeedbackHref = `mailto:${safeSupportEmail}?subject=${encodeURIComponent("Loam Logger Mobile App Feedback")}`;

  const mailBugHref = `mailto:${safeSupportEmail}?subject=${encodeURIComponent("Loam Logger Mobile App Bug Report")}`;

  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style dangerouslySetInnerHTML={{ __html: darkModeStyles }} />
      </Head>

      <Preview>
        The Loam Logger mobile app for iPhone is ready for testing. Download it
        now on TestFlight.
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
              The Loam Logger mobile app is here
            </Heading>

            <Text className="ll-p" style={styles.p}>
              {hello}
            </Text>

            <Text className="ll-p" style={styles.p}>
              This is the one I have been waiting to send. The Loam Logger mobile
              app for iPhone is complete and ready for you to test. Everything
              you use on the web is now in your pocket, built native for iOS.
            </Text>

            <Section className="ll-callout" style={styles.callout}>
              <Text className="ll-p" style={{ ...styles.p, margin: 0 }}>
                <span className="ll-emph" style={styles.emph}>
                  Download on TestFlight:
                </span>
                <br />
                Tap the link below to install the beta and start tracking your
                bikes from anywhere.
              </Text>
            </Section>

            <Section style={{ paddingTop: 8, paddingBottom: 12, textAlign: "center" }}>
              <Button href={safeTestflightUrl} className="ll-button" style={styles.button}>
                Download on TestFlight
              </Button>
            </Section>

            {safeHeroImageUrl ? (
              <Section style={styles.imageContainer}>
                <Img
                  src={safeHeroImageUrl}
                  alt={heroImageAlt}
                  width="60%"
                  style={styles.heroImage}
                />
              </Section>
            ) : null}

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              What the mobile app brings
            </Heading>

            <Text className="ll-bullets" style={styles.bullets}>
              • <span className="ll-emph" style={styles.emph}>Push notifications</span>
              {" "}so you always know what bikes and components need attention,
              without checking the app
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • <span className="ll-emph" style={styles.emph}>Trailhead ready</span>. Check your bike status before you ride without opening a
              browser
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • <span className="ll-emph" style={styles.emph}>Log services on the go</span>. Record maintenance and snooze alerts right from your
              workbench
            </Text>
            <Text className="ll-bullets" style={styles.bullets}>
              • <span className="ll-emph" style={styles.emph}>Full gear and ride tracking</span>. Everything from the web app, optimized for your phone
            </Text>

            <Text className="ll-p" style={styles.p}>
              The web app is not going anywhere. The mobile app is a companion
              that puts the most useful information where you actually need it:
              in your pocket, at the trail, and in the garage.
            </Text>

            <Text className="ll-p" style={styles.p}>
              The iPhone app is available first. A native Android app as well as
              Suunto integration are both in the works and will be live
              before launch.
            </Text>

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              Official launch: May 12th, 2026
            </Heading>

            <Text className="ll-p" style={styles.p}>
              Loam Logger's official launch date is set for{" "}
              <span className="ll-emph" style={styles.emph}>May 12th, 2026</span>.
              Between now and then, this is your window to explore the mobile app,
              push it to its limits, and help shape what ships on day one.
            </Text>

            <Text className="ll-p" style={styles.p}>
              Every feature you have used on the web works on mobile. Import
              rides, inspect components, track wear, manage subscriptions. It is
              all there. If something feels off or missing, now is the time to
              flag it.
            </Text>

            {safeImage2Url ? (
              <Section style={styles.imageContainer}>
                <Img
                  src={safeImage2Url}
                  alt={image2Alt}
                  width="70%"
                  style={styles.heroImage}
                />
              </Section>
            ) : null}

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              Your feedback shapes this
            </Heading>

            <Text className="ll-p" style={styles.p}>
              As a beta tester, your input has directly shaped what this product
              has become. I want to hear everything: ideas, critiques, things
              that feel awkward, things that feel great. No detail is too small.
            </Text>

            <Section style={{ paddingTop: 8, paddingBottom: 12, textAlign: "center" }}>
              <Button href={mailFeedbackHref} className="ll-button" style={styles.button}>
                Share Feedback
              </Button>
            </Section>

            <Section style={{ paddingBottom: 12, textAlign: "center" }}>
              <Button href={mailBugHref} className="ll-button" style={styles.button}>
                Report a Bug
              </Button>
            </Section>

            <Hr className="ll-hr" style={styles.hr} />

            <Heading as="h2" className="ll-h2" style={styles.h2}>
              Spread the word
            </Heading>

            <Text className="ll-p" style={styles.p}>
              Know someone who would find this useful? Share the TestFlight link
              or send them to{" "}
              <Link href={safeDashboardUrl} className="ll-link" style={styles.link}>
                loamlogger.app
              </Link>{" "}
              to create an account. The more riders testing before launch, the
              better Loam Logger will be on day one.
            </Text>

            <Section className="ll-callout" style={styles.callout}>
              <Text className="ll-p" style={{ ...styles.p, margin: 0 }}>
                <span className="ll-emph" style={styles.emph}>
                  TestFlight link to share:
                </span>
                <br />
                <Link href={safeTestflightUrl} className="ll-link" style={styles.link}>
                  {safeTestflightUrl}
                </Link>
              </Text>
            </Section>

            <Hr className="ll-hr" style={styles.hr} />

            <Text className="ll-p" style={styles.p}>
              Thank you for being part of this from the beginning. Seeing this
              hit the App Store on the 12th is going to be a big moment, and it
              would not be happening without you.
            </Text>

            <Section style={{ paddingTop: 4, paddingBottom: 4, textAlign: "center" }}>
              <Button href={safeDashboardUrl} className="ll-button" style={styles.button}>
                Open Loam Logger
              </Button>
            </Section>

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
  imageContainer: {
    margin: "16px 0",
    textAlign: "center" as const,
  },
  heroImage: {
    borderRadius: 12,
    maxWidth: "100%",
    height: "auto",
    display: "inline-block",
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

export const templateConfig: TemplateConfig = {
  id: "mobile-app-launch",
  displayName: "Mobile App Launch (TestFlight)",
  description:
    "Announces the iPhone app is ready for TestFlight beta testing, shares mobile app benefits, and announces the May 12th launch date",
  defaultSubject:
    "Loam Logger for iPhone is ready. Join the TestFlight beta.",
  emailType: "mobile_app_launch",
  templateVersion: MOBILE_APP_LAUNCH_TEMPLATE_VERSION,
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
      key: "testflightUrl",
      label: "TestFlight URL",
      type: "url",
      required: false,
      defaultValue: "https://testflight.apple.com/join/K5UWHpQT",
    },
    {
      key: "dashboardUrl",
      label: "Dashboard URL",
      type: "url",
      required: false,
      defaultValue: "https://loamlogger.app/",
    },
    {
      key: "supportEmail",
      label: "Support Email",
      type: "text",
      required: false,
      defaultValue: "ryan.lecours@loamlogger.app",
    },
    {
      key: "heroImageUrl",
      label: "Hero Image URL (vertical)",
      type: "url",
      required: false,
      defaultValue: "https://loamlogger.app/JohnyZinks.jpg",
    },
    {
      key: "heroImageAlt",
      label: "Hero Image Alt",
      type: "text",
      required: false,
      defaultValue: "Johny flatspins a jump at the Zink Invitational",
    },
    {
      key: "image2Url",
      label: "Second Image URL (horizontal)",
      type: "url",
      required: false,
      defaultValue: "https://loamlogger.app/BarbLegacyDrop.jpg",
    },
    {
      key: "image2Alt",
      label: "Second Image Alt",
      type: "text",
      required: false,
      defaultValue: "Barb drops over the Legacy ATV rig",
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
    React.createElement(MobileAppLaunchEmail, props as MobileAppLaunchEmailProps),
};
