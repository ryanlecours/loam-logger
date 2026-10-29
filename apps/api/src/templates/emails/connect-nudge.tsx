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
import { TOKENS, darkModeStyles, baseStyles } from "./shared-styles";

/**
 * Connect nudge: the one system email in the activation funnel.
 *
 * Sent by services/connect-nudge.service.ts to a rider who finished
 * onboarding with a bike, then went 48 hours without connecting a provider
 * or logging a ride. It is not in the admin template registry on purpose:
 * the sweep decides who gets it and when, and it goes out once per account.
 */

export const CONNECT_NUDGE_TEMPLATE_VERSION = "1.0.0";

export const CONNECT_NUDGE_SUBJECT = "Connect your rides and the tracking starts on its own";

export type ConnectNudgeEmailProps = {
  recipientFirstName?: string;
  /** The rider's first bike, as the dashboard names it. */
  bikeName?: string;
  connectUrl?: string;
  dashboardUrl?: string;
  supportEmail?: string;
  unsubscribeUrl?: string;
};

export default function ConnectNudgeEmail({
  recipientFirstName,
  bikeName,
  connectUrl = "https://loamlogger.app/settings?section=data-sources",
  dashboardUrl = "https://loamlogger.app/dashboard",
  supportEmail = "ryan.lecours@loamlogger.app",
  unsubscribeUrl,
}: ConnectNudgeEmailProps) {
  const safeName = sanitizeUserInput(recipientFirstName);
  const safeBike = sanitizeUserInput(bikeName, 80);
  const greeting = safeName ? `Hi ${safeName},` : "Hi there,";
  const heading = safeBike
    ? `${safeBike} is set up. It just has no rides yet.`
    : "Your bike is set up. It just has no rides yet.";
  const bikeRef = safeBike || "your bike";

  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style dangerouslySetInnerHTML={{ __html: darkModeStyles }} />
      </Head>

      <Preview>
        Link Garmin, Strava, WHOOP or Suunto and the last 12 months of rides import automatically.
      </Preview>

      <Body className="ll-body" style={baseStyles.body}>
        <Container className="ll-container" style={baseStyles.container}>
          <Section style={{ padding: "8px 6px 14px 6px" }}>
            <Text className="ll-brand" style={baseStyles.brand}>
              LoamLogger
            </Text>
          </Section>

          <Section className="ll-card" style={baseStyles.card}>
            <Heading className="ll-h1" style={baseStyles.h1}>
              {heading}
            </Heading>

            <Text className="ll-p" style={baseStyles.p}>
              {greeting}
            </Text>

            <Text className="ll-p" style={baseStyles.p}>
              You added {bikeRef} a couple of days ago, and nothing has changed on it since. Loam Logger works out
              when parts need service from the hours you ride, so until rides arrive it has nothing to go on.
            </Text>

            <Text className="ll-p" style={baseStyles.p}>
              The quickest fix is to connect the app your rides already go to (Garmin, Strava, WHOOP or Suunto).
              Link it once and Loam Logger imports the last 12 months, then keeps up with every new ride from
              there. No typing, no reminders to log anything.
            </Text>

            <Section style={{ paddingTop: 6, paddingBottom: 10, textAlign: "center" }}>
              <Button href={connectUrl} className="ll-button" style={baseStyles.button}>
                Connect a ride source
              </Button>
            </Section>

            <Section className="ll-callout" style={baseStyles.callout}>
              <Text className="ll-p" style={{ ...baseStyles.p, margin: 0 }}>
                <span className="ll-emph" style={baseStyles.emph}>No watch or app?</span> Record a ride in the Loam
                Logger mobile app, or log one by hand from the{" "}
                <Link href={dashboardUrl} className="ll-link" style={baseStyles.link}>
                  dashboard
                </Link>
                . Either one starts the clock.
              </Text>
            </Section>

            <Text className="ll-p" style={baseStyles.p}>
              If you hit a snag connecting, reply to this email and I will sort it out with you.
            </Text>

            <Hr className="ll-hr" style={baseStyles.hr} />

            <Text
              className="ll-signature"
              style={{ ...baseStyles.p, marginTop: 4, marginBottom: 0, color: TOKENS.text, fontWeight: 800 }}
            >
              Ryan
            </Text>
            <Text className="ll-p" style={{ ...baseStyles.p, marginBottom: 0 }}>
              Founder, Loam Logger
            </Text>
            <Text className="ll-p" style={{ ...baseStyles.p, marginBottom: 0, fontSize: 12 }}>
              <Link href={`mailto:${supportEmail}`} className="ll-link" style={baseStyles.link}>
                {supportEmail}
              </Link>
            </Text>
          </Section>

          <Section style={baseStyles.footer}>
            <Text className="ll-footer" style={{ ...baseStyles.footerText, marginBottom: 0 }}>
              Loam Logger is a product of Loam Labs LLC. You are receiving this email because you have a Loam
              Logger account.
            </Text>

            {unsubscribeUrl ? (
              <Text className="ll-footer" style={{ ...baseStyles.footerText, marginTop: 6 }}>
                <Link href={unsubscribeUrl} className="ll-footer-link" style={baseStyles.footerLink}>
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
