import { Link } from "react-router";
import { motion } from 'motion/react';
import { Card } from '../components/ui';

export const DELETION_EMAIL = 'ryan.lecours@loamlogger.app';

const linkClass = 'text-mint hover:text-sage transition-colors underline';

/**
 * Public account-deletion page. Google Play requires every app that lets
 * users create an account to list a URL where they can request deletion
 * without reinstalling the app, and the page must name the app or developer,
 * give the steps, and say which data is deleted and which is kept and for how
 * long. This URL is entered in Play Console (App content > Data safety), so
 * treat the path as a public contract, like the anchors in PrivacyPolicy.
 *
 * Keep "What is kept" in step with the privacy policy's Retention & Deletion
 * section and with what DELETE /auth/delete-account actually removes.
 */
export default function DeleteAccount() {
    const mailto = `mailto:${DELETION_EMAIL}?subject=${encodeURIComponent('Delete my Loam Logger account')}`;

    return (
        <div className="min-h-screen bg-app py-16 px-6">
            <div className="container max-w-4xl mx-auto">
                <motion.div
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6 }}
                >
                    <Link to="/" className="btn-secondary mb-6 inline-flex items-center gap-2">
                        &larr; Loam Logger
                    </Link>

                    <Card variant="glass" className="p-8">
                        <div className="space-y-6">
                            <div>
                                <h1 className="title-page mb-2">Delete your Loam Logger account</h1>
                                <p className="body text-muted">
                                    Loam Logger is made by Loam Labs LLC. You can delete your account and the data stored with it from the app, from this website, or by email. Deletion is permanent and cannot be undone.
                                </p>
                            </div>

                            <div className="space-y-6">
                                <section id="cancel-subscription">
                                    <h2 className="card-title mb-3">First, cancel any subscription</h2>
                                    <p className="body text-muted mb-3">
                                        Deleting your account does not cancel a Loam Logger Pro subscription. If you have one, cancel it before you delete your account:
                                    </p>
                                    <ul className="list-disc pl-6 space-y-2 body text-muted">
                                        <li><strong className="text-cream">Bought on Android:</strong> in the Google Play Store, open Payments &amp; subscriptions, then Subscriptions.</li>
                                        <li><strong className="text-cream">Bought on iPhone or iPad:</strong> in the Settings app, tap your name, then Subscriptions.</li>
                                        <li><strong className="text-cream">Bought on the website:</strong> sign in, open Settings, then Account, and choose Manage Subscription.</li>
                                    </ul>
                                </section>

                                <section id="in-the-app">
                                    <h2 className="card-title mb-3">Delete from the app</h2>
                                    <ol className="list-decimal pl-6 space-y-2 body text-muted">
                                        <li>Open Loam Logger and sign in.</li>
                                        <li>Go to the Settings tab.</li>
                                        <li>Scroll to the bottom and tap Delete Account.</li>
                                        <li>Tap Delete Account again to confirm.</li>
                                    </ol>
                                </section>

                                <section id="on-the-web">
                                    <h2 className="card-title mb-3">Delete on the website</h2>
                                    <ol className="list-decimal pl-6 space-y-2 body text-muted">
                                        <li><Link to="/login" className={linkClass}>Sign in</Link> at loamlogger.app.</li>
                                        <li>Open <Link to="/settings?section=danger" className={linkClass}>Settings, then Danger Zone</Link>.</li>
                                        <li>Select Delete Account, then confirm.</li>
                                    </ol>
                                </section>

                                <section id="by-email">
                                    <h2 className="card-title mb-3">Ask us by email</h2>
                                    <p className="body text-muted">
                                        If you can't sign in, email <a className={linkClass} href={mailto}>{DELETION_EMAIL}</a> from the address on your account and ask us to delete it. We delete the same data as the steps above and reply when it's done.
                                    </p>
                                </section>

                                <section id="what-is-deleted">
                                    <h2 className="card-title mb-3">What is deleted</h2>
                                    <p className="body text-muted mb-3">
                                        Deleting your account removes, immediately and permanently:
                                    </p>
                                    <ul className="list-disc pl-6 space-y-2 body text-muted">
                                        <li>Your profile, email address and sign-in methods (password, Google and Apple).</li>
                                        <li>Your bikes, components, service history and notes.</li>
                                        <li>Your rides, including GPS tracks, weather and ride notes.</li>
                                        <li>Your connections to Garmin, Strava, WHOOP and Suunto, and the access we held for them. We also ask Garmin and Strava to revoke that access.</li>
                                        <li>Share links you created, which stop working.</li>
                                        <li>Your notification and email preferences.</li>
                                    </ul>
                                    <p className="body text-muted mt-3">
                                        Activities stay in your Garmin, Strava, WHOOP or Suunto account. Deleting Loam Logger does not touch them.
                                    </p>
                                </section>

                                <section id="what-is-kept">
                                    <h2 className="card-title mb-3">What is kept, and for how long</h2>
                                    <ul className="list-disc pl-6 space-y-2 body text-muted">
                                        <li><strong className="text-cream">Error reports (Sentry):</strong> kept for up to 90 days, then deleted automatically.</li>
                                        <li><strong className="text-cream">Usage analytics (PostHog):</strong> kept for up to 12 months, then deleted automatically.</li>
                                        <li><strong className="text-cream">Payment records:</strong> Google Play, the App Store and Stripe keep their own records of your purchases under their policies.</li>
                                    </ul>
                                </section>

                                <section id="delete-some-data">
                                    <h2 className="card-title mb-3">Delete some data without deleting your account</h2>
                                    <p className="body text-muted">
                                        You can delete individual rides and bikes in the app or on the website at any time. Disconnecting a provider in Settings deletes the raw GPS tracks imported from it. To have anything else removed, email <a className={linkClass} href={`mailto:${DELETION_EMAIL}`}>{DELETION_EMAIL}</a>.
                                    </p>
                                </section>

                                <section className="pt-4 border-t border-app">
                                    <p className="text-sm text-muted">
                                        More detail is in our <Link to="/privacy#retention-and-deletion" className={linkClass}>Privacy Policy</Link>.
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
