import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from 'motion/react';
import { Card } from '../components/ui';

/**
 * Every <section> below carries a stable `id`. Those ids are load-bearing:
 * partners are given direct anchor links into specific clauses (Garmin's
 * developer program requires one to /privacy#garmin-connect-data as a
 * condition of production API access), and a renamed or removed id silently
 * breaks a link we have already handed to a third party. Treat them as a
 * public contract, not as markup detail.
 */
export default function PrivacyPolicy() {
    const navigate = useNavigate();

    // Native hash scrolling does not survive this page: the content mounts
    // behind a fade/translate animation, so the browser resolves the anchor
    // against a layout that is still moving and lands in the wrong place (or
    // nowhere). Scroll explicitly once the entry animation has settled.
    useEffect(() => {
        const id = window.location.hash.slice(1);
        if (!id) return;

        const timer = setTimeout(() => {
            document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 650); // just past the 0.6s entry transition below

        return () => clearTimeout(timer);
    }, []);

    return (
        <div className="min-h-screen bg-app py-16 px-6">
            <div className="container max-w-4xl mx-auto">
                <motion.div
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6 }}
                >
                    {/* Back Button */}
                    <button
                        onClick={() => navigate("/")}
                        className="btn-secondary mb-6 inline-flex items-center gap-2"
                    >
                        ← Back
                    </button>

                    <Card variant="glass" className="p-8">
                        <div className="space-y-6">
                            <div>
                                <h1 className="section-title mb-2">Privacy Policy</h1>
                                <p className="text-sm text-muted">Last updated: July 26, 2026</p>
                            </div>

                            {/* Deliberately NOT an inner scroll container. A
                                nested overflow-y region swallows anchor
                                navigation — the browser scrolls the document,
                                not this box — which would break the direct
                                clause links partners rely on. It also made the
                                policy awkward to read and impossible to print
                                in full. */}
                            <div className="space-y-6">
                                <p className="body">
                                    Loam Logger ("we," "us," or "our") is operated by Loam Labs LLC.
                                    This policy explains what data we collect, how we use it, and your choices.
                                </p>

                                <section id="data-we-collect">
                                    <h2 className="card-title mb-3">1. Data We Collect</h2>
                                    <ul className="list-disc pl-6 space-y-2 body text-muted">
                                        <li><strong className="text-cream">Account & Auth:</strong> Basic profile info from OAuth providers (e.g., Garmin, Strava, WHOOP, Suunto, Google, Apple), such as your name, email, and provider ID.</li>
                                        <li><strong className="text-cream">Fitness Data (when connected):</strong> Rides, distance, elevation, duration, heart rate metrics, activity metadata.</li>
                                        <li><strong className="text-cream">Payment & Subscription Data:</strong> Subscription tier, purchase history, and transaction identifiers processed through Apple In-App Purchase (via RevenueCat) or Stripe. We do not store full payment card details.</li>
                                        <li><strong className="text-cream">App Usage & Behavioral Analytics:</strong> Device/browser info, IP address, in-app events (e.g., bike added, ride logged), and technical diagnostics for performance monitoring. On the web app, a small percentage of sessions may be recorded for playback (see Section 6).</li>
                                        <li><strong className="text-cream">Location Data:</strong> Ride start coordinates (latitude/longitude) from your connected fitness provider, used to display ride location names and fetch weather conditions. We do not track your location in real time.</li>
                                        <li><strong className="text-cream">Biometric Authentication:</strong> The mobile app supports Face ID and Touch ID for convenient app unlock. All biometric data is processed entirely on your device by Apple's Secure Enclave. We never receive, transmit, or store your biometric data.</li>
                                    </ul>
                                </section>

                                <section id="how-we-use-data">
                                    <h2 className="card-title mb-3">2. How We Use Data</h2>
                                    <ul className="list-disc pl-6 space-y-2 body text-muted">
                                        <li>Provide core features (ride import, analytics, bike/component tracking).</li>
                                        <li>Process subscriptions and manage account entitlements.</li>
                                        <li>Improve reliability, performance, and user experience.</li>
                                        <li>Secure accounts and prevent abuse.</li>
                                    </ul>
                                </section>

                                <section id="legal-basis">
                                    <h2 className="card-title mb-3">3. Legal Basis for Processing</h2>
                                    <p className="body text-muted">
                                        If you are located in the European Economic Area (EEA), United Kingdom, or Switzerland, our legal basis for processing your data depends on the type of data and the context:
                                    </p>
                                    <ul className="list-disc pl-6 space-y-2 body text-muted mt-3">
                                        <li><strong className="text-cream">Contractual necessity:</strong> Account data, fitness data, and subscription data are processed to provide the service you signed up for.</li>
                                        <li><strong className="text-cream">Legitimate interest:</strong> Error tracking (Sentry), product analytics (PostHog), and security monitoring are processed to maintain and improve the service. You may object to analytics processing by opting out in Settings (see Section 6 for details).</li>
                                        <li><strong className="text-cream">Consent:</strong> Where required by law, we obtain your consent before processing (e.g., push notifications, optional integrations).</li>
                                    </ul>
                                </section>

                                <section id="integration-providers">
                                    <h2 className="card-title mb-3">4. Integration Provider Data</h2>
                                    <p className="body text-muted">
                                        When you connect a fitness platform, we access data via that provider's APIs solely to deliver Loam Logger features. We do not sell provider-derived data. Access is limited to the scopes you approve and can be revoked at any time within Loam Logger or through the provider.
                                    </p>
                                    <p className="body text-muted mt-2">
                                        Supported providers: Garmin, Strava, WHOOP, and Suunto. Each provider has its own terms and privacy policy governing your data on their platform.
                                    </p>
                                </section>

                                <section id="garmin-connect-data">
                                    <h2 className="card-title mb-3">4a. Garmin Connect Data</h2>
                                    <p className="body text-muted">
                                        This section describes specifically how Garmin data is collected, used, processed, stored, and shared.
                                    </p>

                                    <h3 className="text-base font-semibold text-cream mt-5 mb-2">What we collect</h3>
                                    <p className="body text-muted">
                                        When you connect Garmin Connect, we access the <strong className="text-cream">Garmin Activity API only</strong>. We do not request, receive, or store health or wellness data — no daily summaries, sleep, stress, body composition, pulse ox, respiration, heart rate variability, or Body Battery. For cycling activities only, we receive:
                                    </p>
                                    <ul className="list-disc pl-6 space-y-2 body text-muted mt-3">
                                        <li><strong className="text-cream">Activity summary:</strong> activity type and name, start time, duration, distance, elevation gain, average and maximum heart rate, starting coordinates, and the Garmin device model that recorded the activity.</li>
                                        <li><strong className="text-cream">Activity details (per-point samples), when provided:</strong> timestamp, GPS position, elevation, speed, cadence, heart rate, and power, sampled through the ride. These are used to draw your route map and to detect chairlift/shuttle segments so they are not counted as pedaling time.</li>
                                        <li><strong className="text-cream">Account identifier:</strong> your Garmin user ID, plus OAuth access and refresh tokens, used solely to maintain the connection.</li>
                                    </ul>

                                    <h3 className="text-base font-semibold text-cream mt-5 mb-2">How we use and process it</h3>
                                    <p className="body text-muted">
                                        Ride duration from Garmin activities accrues against the components installed on your bike to produce component wear hours and service predictions. Garmin data is therefore an input to derived outputs shown throughout the app, and those outputs identify Garmin as a contributing data source. Starting coordinates are used to name the ride location and fetch historical weather for that ride. We do not sell Garmin data, use it for advertising, or share it with data brokers.
                                    </p>

                                    <h3 className="text-base font-semibold text-cream mt-5 mb-2">Third parties that process it</h3>
                                    <p className="body text-muted">
                                        Garmin-derived data is stored in our database and processed by the infrastructure providers listed in <a className="text-mint hover:text-sage transition-colors underline" href="#sharing-and-processors">Section 5</a> — Railway (API hosting), Neon (database), and Vercel (web hosting).
                                    </p>
                                    <p className="body text-muted mt-2">
                                        <strong className="text-cream">Third-party AI processing:</strong> if you are on a paid plan, we generate a short plain-language maintenance summary for your bike using Anthropic, PBC (the Claude API). What is sent is the <em>derived</em> maintenance state — component names, accumulated hours, service intervals, and status. Raw Garmin activity data, GPS coordinates, per-point samples, Garmin account identifiers, and your name and email are <strong className="text-cream">not</strong> sent. Anthropic acts as our sub-processor, does not use the data to train models, and returns the summary only to you.
                                    </p>
                                    <p className="body text-muted mt-2">
                                        Garmin data is <strong className="text-cream">not</strong> sent to our analytics or error-tracking providers. PostHog receives product events without fitness data, and Sentry receives no ride information (Sections 6 and 7).
                                    </p>

                                    <h3 className="text-base font-semibold text-cream mt-5 mb-2">Storage, retention, and deletion</h3>
                                    <p className="body text-muted">
                                        Garmin data is stored in the United States (see <a className="text-mint hover:text-sage transition-colors underline" href="#international-transfers">Section 12</a>), encrypted in transit, and retained while your account is active.
                                    </p>
                                    <ul className="list-disc pl-6 space-y-2 body text-muted mt-3">
                                        <li><strong className="text-cream">If you disconnect Garmin</strong> in Loam Logger, or revoke access from your Garmin account, we revoke our access tokens, stop all further imports, and delete the raw per-point GPS tracks supplied by Garmin. Rides already imported remain as part of your own maintenance record, because deleting them would erase the component service history the app exists to keep.</li>
                                        <li><strong className="text-cream">If Garmin notifies us that you deregistered,</strong> we apply the same deletion automatically.</li>
                                        <li><strong className="text-cream">You can request full deletion</strong> of previously imported Garmin rides at any time, and deleting your Loam Logger account removes all of it.</li>
                                    </ul>

                                    <p className="body text-muted mt-4">
                                        Your data on Garmin's own platform is governed by <a className="text-mint hover:text-sage transition-colors underline" href="https://www.garmin.com/en-US/privacy/connect/" target="_blank" rel="noopener noreferrer">Garmin's privacy policy</a>. You can review or revoke Loam Logger's access at any time from your Garmin Connect account settings.
                                    </p>
                                </section>

                                <section id="sharing-and-processors">
                                    <h2 className="card-title mb-3">5. Sharing & Third-Party Processors</h2>
                                    <p className="body text-muted mb-3">
                                        We do not sell personal data. We share data with the following categories of trusted processors under data-processing terms:
                                    </p>
                                    <ul className="list-disc pl-6 space-y-2 body text-muted">
                                        <li><strong className="text-cream">Hosting & Infrastructure:</strong> Railway (API hosting), Vercel (web hosting), Neon (database).</li>
                                        <li><strong className="text-cream">Error Tracking:</strong> Sentry (see Section 7).</li>
                                        <li><strong className="text-cream">Product Analytics:</strong> PostHog (see Section 6).</li>
                                        <li><strong className="text-cream">Subscription Management:</strong> RevenueCat (manages Apple and Google in-app purchases; receives your user ID, subscription status, and purchase events).</li>
                                        <li><strong className="text-cream">Payment Processing:</strong> Stripe (processes web subscription payments; receives your email and payment details).</li>
                                        <li><strong className="text-cream">Email:</strong> Resend (transactional and product emails).</li>
                                        <li><strong className="text-cream">AI Processing:</strong> Anthropic, PBC (Claude API) generates the plain-language maintenance summary shown on paid plans. It receives derived maintenance state only — component names, hours, service intervals, and status — never your name, email, GPS coordinates, raw activity data, credentials, or payment details. Anthropic does not use this data to train models. See <a className="text-mint hover:text-sage transition-colors underline" href="https://www.anthropic.com/legal/privacy" target="_blank" rel="noopener noreferrer">Anthropic's privacy policy</a>.</li>
                                    </ul>
                                    <p className="body text-muted mt-3">
                                        We may also disclose data if required by law or to protect rights and safety.
                                    </p>
                                </section>

                                <section id="analytics-and-session-replay">
                                    <h2 className="card-title mb-3">6. Product Analytics & Session Replay</h2>
                                    <p className="body text-muted mb-3">
                                        We use PostHog (<a className="text-mint hover:text-sage transition-colors underline" href="https://posthog.com" target="_blank" rel="noopener noreferrer">posthog.com</a>), operated by PostHog Inc. and hosted in the United States, as a third-party data processor to understand how people use Loam Logger so we can improve it. PostHog receives:
                                    </p>
                                    <ul className="list-disc pl-6 space-y-2 body text-muted mb-3">
                                        <li><strong className="text-cream">Identity:</strong> your internal user ID, email, name, subscription tier, and role. This lets us associate events with your account across sessions and devices.</li>
                                        <li><strong className="text-cream">Behavioral events:</strong> pages visited, buttons clicked, and product-level events such as "bike added", "ride logged", "subscription started", or "provider connected".</li>
                                        <li><strong className="text-cream">Technical context:</strong> IP address, browser and device information, and the referring URL.</li>
                                        <li><strong className="text-cream">Session recordings (sampled, web only):</strong> on a small percentage of sessions, plus sessions where an error occurs, PostHog records a video-like playback of your interactions with the app. All <em>form inputs</em> (text fields, passwords, selects, textareas) are masked by default so their contents are not captured. No fitness data, ride details, or bike photos are included in the analytics event stream.</li>
                                    </ul>
                                    <p className="body text-muted">
                                        PostHog acts as our data processor under a data-processing agreement. They do not sell your data. For details on their practices, see <a className="text-mint hover:text-sage transition-colors underline" href="https://posthog.com/privacy" target="_blank" rel="noopener noreferrer">PostHog's privacy policy</a>. You can opt out of PostHog analytics at any time from the <strong className="text-cream">Privacy</strong> section in your account <a className="text-mint hover:text-sage transition-colors underline" href="/settings">Settings</a>. The opt-out is stored on your account, so it applies everywhere you're signed in.
                                    </p>
                                </section>

                                <section id="error-tracking">
                                    <h2 className="card-title mb-3">7. Error Tracking & Crash Reporting</h2>
                                    <p className="body text-muted">
                                        We use Sentry (<a className="text-mint hover:text-sage transition-colors underline" href="https://sentry.io" target="_blank" rel="noopener noreferrer">sentry.io</a>), a third-party error tracking service, to monitor application stability and diagnose crashes. When an error occurs, Sentry may receive a pseudonymized user identifier (an internal ID, not your name or email), device and OS information, and technical details about the error. No fitness data, ride information, or personal content is sent to Sentry. Sentry retains error data for 90 days by default. For more information, see <a className="text-mint hover:text-sage transition-colors underline" href="https://sentry.io/privacy/" target="_blank" rel="noopener noreferrer">Sentry's privacy policy</a>.
                                    </p>
                                </section>

                                <section id="cookies-and-local-storage">
                                    <h2 className="card-title mb-3">8. Cookies & Local Storage</h2>
                                    <p className="body text-muted">
                                        The web app uses cookies for session authentication and CSRF protection. The mobile app uses encrypted on-device storage (Keychain/SecureStore) for authentication tokens and preferences. We do not use cookies for advertising or cross-site tracking.
                                    </p>
                                </section>

                                <section id="retention-and-deletion">
                                    <h2 className="card-title mb-3">9. Retention & Deletion</h2>
                                    <p className="body text-muted mb-3">
                                        We retain your data while your account is active and for a reasonable period afterward as needed for service integrity and legal obligations. Specifically:
                                    </p>
                                    <ul className="list-disc pl-6 space-y-2 body text-muted mb-3">
                                        <li><strong className="text-cream">Account and ride data:</strong> Retained until you delete your account.</li>
                                        <li><strong className="text-cream">Raw GPS tracks from a connected provider:</strong> Deleted when you disconnect that provider (see <a className="text-mint hover:text-sage transition-colors underline" href="#garmin-connect-data">Section 4a</a> for the Garmin specifics).</li>
                                        <li><strong className="text-cream">Error tracking data (Sentry):</strong> Retained for 90 days.</li>
                                        <li><strong className="text-cream">Analytics data (PostHog):</strong> Retained for up to 12 months.</li>
                                    </ul>
                                    <p className="body text-muted">
                                        You can delete your account and all associated data at any time from Settings or by contacting us.
                                        Disconnecting a provider stops new imports; you may also request removal of previously imported data from that provider.
                                    </p>
                                </section>

                                <section id="security">
                                    <h2 className="card-title mb-3">10. Security</h2>
                                    <p className="body text-muted">
                                        We use industry-standard security controls including encrypted storage, HTTPS for all communications, and access controls. However, no method of transmission or storage is 100% secure.
                                    </p>
                                </section>

                                <section id="children">
                                    <h2 className="card-title mb-3">11. Children</h2>
                                    <p className="body text-muted">
                                        You must be at least 16 years old to use Loam Logger (see our Terms of Service). We do not knowingly collect data from anyone under 16. If we learn that a user is under 16, we will delete their account and associated data promptly.
                                    </p>
                                </section>

                                <section id="international-transfers">
                                    <h2 className="card-title mb-3">12. International Transfers</h2>
                                    <p className="body text-muted">
                                        Your data is processed in the United States. If you are located outside the United States, your data will be transferred to the U.S. for processing. Where required by law (e.g., GDPR), we rely on Standard Contractual Clauses (SCCs) or other approved transfer mechanisms to ensure appropriate safeguards. Copies of applicable SCCs are available upon request by contacting us at the email below.
                                    </p>
                                </section>

                                <section id="your-rights">
                                    <h2 className="card-title mb-3">13. Your Rights</h2>
                                    <p className="body text-muted mb-3">
                                        Depending on your jurisdiction, you may have the right to:
                                    </p>
                                    <ul className="list-disc pl-6 space-y-2 body text-muted mb-3">
                                        <li>Access the personal data we hold about you</li>
                                        <li>Correct inaccurate data</li>
                                        <li>Delete your account and associated data</li>
                                        <li>Object to processing based on legitimate interest</li>
                                        <li>Export your data in a portable format</li>
                                        <li>Opt out of analytics (via Settings)</li>
                                    </ul>
                                    <p className="body text-muted">
                                        To exercise any of these rights, contact us at the email below or use the in-app controls where available.
                                    </p>
                                </section>

                                <section id="changes">
                                    <h2 className="card-title mb-3">14. Changes</h2>
                                    <p className="body text-muted">
                                        We may update this policy. We will post the new date above and, if the changes are material, notify you in-app or by email.
                                    </p>
                                </section>

                                <section id="contact">
                                    <h2 className="card-title mb-3">15. Contact</h2>
                                    <p className="body">
                                        Questions, deletion requests, or data rights inquiries: <a className="text-mint hover:text-sage transition-colors underline" href="mailto:ryan.lecours@loamlogger.app">ryan.lecours@loamlogger.app</a>
                                    </p>
                                </section>
                            </div>
                        </div>
                    </Card>
                </motion.div>
            </div>
        </div>
    );
}
