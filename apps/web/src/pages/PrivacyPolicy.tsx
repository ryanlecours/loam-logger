import { useNavigate } from "react-router-dom";
import { motion } from 'motion/react';
import { Card } from '../components/ui';

export default function PrivacyPolicy() {
    const navigate = useNavigate();

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
                                <p className="text-sm text-muted">Last updated: May 2, 2026</p>
                            </div>

                            <div className="max-h-[70vh] overflow-y-auto space-y-6 pr-4">
                                <p className="body">
                                    Loam Logger ("we," "us," or "our") is operated by Loam Labs LLC.
                                    This policy explains what data we collect, how we use it, and your choices.
                                </p>

                                <section>
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

                                <section>
                                    <h2 className="card-title mb-3">2. How We Use Data</h2>
                                    <ul className="list-disc pl-6 space-y-2 body text-muted">
                                        <li>Provide core features (ride import, analytics, bike/component tracking).</li>
                                        <li>Process subscriptions and manage account entitlements.</li>
                                        <li>Improve reliability, performance, and user experience.</li>
                                        <li>Secure accounts and prevent abuse.</li>
                                    </ul>
                                </section>

                                <section>
                                    <h2 className="card-title mb-3">3. Legal Basis for Processing</h2>
                                    <p className="body text-muted">
                                        If you are located in the European Economic Area (EEA), United Kingdom, or Switzerland, our legal basis for processing your data depends on the type of data and the context:
                                    </p>
                                    <ul className="list-disc pl-6 space-y-2 body text-muted mt-3">
                                        <li><strong className="text-cream">Contractual necessity:</strong> Account data, fitness data, and subscription data are processed to provide the service you signed up for.</li>
                                        <li><strong className="text-cream">Legitimate interest:</strong> Error tracking (Sentry), product analytics (PostHog), and security monitoring are processed to maintain and improve the service. You may object to analytics processing by opting out in Settings.</li>
                                        <li><strong className="text-cream">Consent:</strong> Where required by law, we obtain your consent before processing (e.g., push notifications, optional integrations).</li>
                                    </ul>
                                </section>

                                <section>
                                    <h2 className="card-title mb-3">4. Integration Provider Data</h2>
                                    <p className="body text-muted">
                                        When you connect a fitness platform, we access data via that provider's APIs solely to deliver Loam Logger features. We do not sell provider-derived data. Access is limited to the scopes you approve and can be revoked at any time within Loam Logger or through the provider.
                                    </p>
                                    <p className="body text-muted mt-2">
                                        Supported providers: Garmin, Strava, WHOOP, and Suunto. Each provider has its own terms and privacy policy governing your data on their platform.
                                    </p>
                                </section>

                                <section>
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
                                    </ul>
                                    <p className="body text-muted mt-3">
                                        We may also disclose data if required by law or to protect rights and safety.
                                    </p>
                                </section>

                                <section>
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

                                <section>
                                    <h2 className="card-title mb-3">7. Error Tracking & Crash Reporting</h2>
                                    <p className="body text-muted">
                                        We use Sentry (<a className="text-mint hover:text-sage transition-colors underline" href="https://sentry.io" target="_blank" rel="noopener noreferrer">sentry.io</a>), a third-party error tracking service, to monitor application stability and diagnose crashes. When an error occurs, Sentry may receive a pseudonymized user identifier (an internal ID, not your name or email), device and OS information, and technical details about the error. No fitness data, ride information, or personal content is sent to Sentry. Sentry retains error data for 90 days by default. For more information, see <a className="text-mint hover:text-sage transition-colors underline" href="https://sentry.io/privacy/" target="_blank" rel="noopener noreferrer">Sentry's privacy policy</a>.
                                    </p>
                                </section>

                                <section>
                                    <h2 className="card-title mb-3">8. Cookies & Local Storage</h2>
                                    <p className="body text-muted">
                                        The web app uses cookies for session authentication and CSRF protection. The mobile app uses encrypted on-device storage (Keychain/SecureStore) for authentication tokens and preferences. We do not use cookies for advertising or cross-site tracking.
                                    </p>
                                </section>

                                <section>
                                    <h2 className="card-title mb-3">9. Retention & Deletion</h2>
                                    <p className="body text-muted mb-3">
                                        We retain your data while your account is active and for a reasonable period afterward as needed for service integrity and legal obligations. Specifically:
                                    </p>
                                    <ul className="list-disc pl-6 space-y-2 body text-muted mb-3">
                                        <li><strong className="text-cream">Account and ride data:</strong> Retained until you delete your account.</li>
                                        <li><strong className="text-cream">Error tracking data (Sentry):</strong> Retained for 90 days.</li>
                                        <li><strong className="text-cream">Analytics data (PostHog):</strong> Retained for up to 12 months.</li>
                                    </ul>
                                    <p className="body text-muted">
                                        You can delete your account and all associated data at any time from Settings or by contacting us.
                                        Disconnecting a provider stops new imports; you may also request removal of previously imported data from that provider.
                                    </p>
                                </section>

                                <section>
                                    <h2 className="card-title mb-3">10. Security</h2>
                                    <p className="body text-muted">
                                        We use industry-standard security controls including encrypted storage, HTTPS for all communications, and access controls. However, no method of transmission or storage is 100% secure.
                                    </p>
                                </section>

                                <section>
                                    <h2 className="card-title mb-3">11. Children</h2>
                                    <p className="body text-muted">
                                        Loam Logger is not intended for children under 18. We do not knowingly collect data from children under 13 (the age threshold under COPPA). If we learn that we have collected data from a child under 13, we will delete it promptly.
                                    </p>
                                </section>

                                <section>
                                    <h2 className="card-title mb-3">12. International Transfers</h2>
                                    <p className="body text-muted">
                                        Your data is processed in the United States. If you are located outside the United States, your data will be transferred to the U.S. for processing. Where required by law (e.g., GDPR), we rely on Standard Contractual Clauses or other approved transfer mechanisms to ensure appropriate safeguards.
                                    </p>
                                </section>

                                <section>
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

                                <section>
                                    <h2 className="card-title mb-3">14. Changes</h2>
                                    <p className="body text-muted">
                                        We may update this policy. We will post the new date above and, if the changes are material, notify you in-app or by email.
                                    </p>
                                </section>

                                <section>
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
