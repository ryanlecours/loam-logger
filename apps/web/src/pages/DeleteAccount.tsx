import { useEffect, useState } from "react";
import { Link } from "react-router";
import { motion } from 'motion/react';
import { Card } from '../components/ui';

export const DELETION_EMAIL = 'ryan.lecours@loamlogger.app';

const linkClass = 'text-mint hover:text-sage transition-colors underline';

/**
 * Asks the API to email a deletion confirmation link. The API answers 200
 * whether or not the address has an account, so the success copy is
 * conditional ("if that address has an account"). Sent without credentials,
 * like the forgot-password request: no session cookie, so no CSRF header.
 */
function DeleteByEmailForm() {
    const [email, setEmail] = useState('');
    const [submitted, setSubmitted] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        if (!email.trim()) {
            setError('Please enter your email.');
            return;
        }

        setIsLoading(true);
        try {
            const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/delete-account/request`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email.trim() }),
            });

            if (res.status === 429) {
                const data = await res.json().catch(() => ({}));
                const retryAfter = typeof data.retryAfter === 'number' ? data.retryAfter : 60;
                setError(`Too many attempts. Please try again in ${retryAfter} seconds.`);
                return;
            }

            setSubmitted(true);
        } catch {
            setError('A network error occurred. Please try again.');
        } finally {
            setIsLoading(false);
        }
    }

    if (submitted) {
        return (
            <p role="status" className="body text-cream">
                If {email.trim()} has a Loam Logger account, we've sent it a confirmation link. Open it within 60 minutes to finish deleting your account.
            </p>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-3" noValidate>
            <div>
                <label htmlFor="delete-email" className="block text-sm font-medium text-primary mb-1">
                    Account email
                </label>
                <input
                    type="email"
                    id="delete-email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full px-3 py-2 bg-surface border border-app rounded-lg text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-mint focus:border-transparent"
                />
            </div>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <button
                type="submit"
                disabled={isLoading}
                className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {isLoading ? 'Sending…' : 'Email me a confirmation link'}
            </button>
        </form>
    );
}

/**
 * Public account-deletion page. Google Play requires every app that lets
 * users create an account to list a URL where they can request deletion
 * without reinstalling the app, and the page must name the app or developer,
 * give the steps, and say which data is deleted and which is kept and for how
 * long. This URL is entered in Play Console (App content > Data safety), so
 * treat the path as a public contract, like the anchors in PrivacyPolicy.
 *
 * Keep "What is kept" in step with the privacy policy's Retention & Deletion
 * section and with what deleteUserAccount (api services/account-deletion.service.ts)
 * actually removes. Every deletion path, signed in or emailed, runs it.
 */
export default function DeleteAccount() {
    // Same fix as PrivacyPolicy: the card mounts behind a fade/translate, so
    // native hash scrolling lands in the wrong place. The confirm page links
    // to #by-email and #what-is-deleted, so scroll once the animation settles.
    useEffect(() => {
        const id = window.location.hash.slice(1);
        if (!id) return;
        const timer = setTimeout(() => {
            document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 650);
        return () => clearTimeout(timer);
    }, []);

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
                                    Loam Logger is made by Loam Labs LLC. You can delete your account and the data stored with it from the app, from this website, or with a link we email you. Deletion is permanent and cannot be undone.
                                </p>
                                <p className="body text-muted mt-3">
                                    If you pay for Loam Logger Pro through the App Store or Google Play, <a className={linkClass} href="#cancel-subscription">cancel that subscription</a> first. Deleting your account does not cancel it.
                                </p>
                            </div>

                            <div className="space-y-6">
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
                                    <h2 className="card-title mb-3">Delete by email</h2>
                                    <p className="body text-muted mb-4">
                                        If you can't sign in, enter the email address on your account. We'll send it a link to confirm the deletion. The link expires in 60 minutes, and nothing is deleted until you confirm.
                                    </p>
                                    <DeleteByEmailForm />
                                    <p className="body text-muted mt-4">
                                        No longer have access to that inbox? Email <a className={linkClass} href={mailto}>{DELETION_EMAIL}</a> and we'll help.
                                    </p>
                                </section>

                                <section id="cancel-subscription">
                                    <h2 className="card-title mb-3">Cancel an App Store or Google Play subscription first</h2>
                                    <p className="body text-muted mb-3">
                                        Deleting your account does not cancel a Loam Logger Pro subscription bought through the App Store or Google Play. If you have one, cancel it before you delete your account:
                                    </p>
                                    <ul className="list-disc pl-6 space-y-2 body text-muted">
                                        <li><strong className="text-cream">Bought on Android:</strong> in the Google Play Store, open Payments &amp; subscriptions, then Subscriptions.</li>
                                        <li><strong className="text-cream">Bought on iPhone or iPad:</strong> in the Settings app, tap your name, then Subscriptions.</li>
                                        <li><strong className="text-cream">Bought on the website:</strong> nothing to do. Deleting your account cancels it, and you will not be charged again.</li>
                                    </ul>
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
                                    <p className="body text-muted mb-3">
                                        You can remove rides, bikes and imported GPS tracks at any time and keep your account. Each deletion is permanent.
                                    </p>

                                    <h3 className="text-base font-semibold text-cream mb-2">Delete a ride</h3>
                                    <ul className="list-disc pl-6 space-y-2 body text-muted mb-4">
                                        <li><strong className="text-cream">In the app:</strong> open the Rides tab, tap the ride, tap Delete, then tap Delete again to confirm.</li>
                                        <li><strong className="text-cream">On the website:</strong> open <Link to="/rides" className={linkClass}>Rides</Link> and select Delete ride on the ride, then confirm.</li>
                                    </ul>
                                    <p className="body text-muted mb-4">
                                        This deletes the ride with its GPS track, weather and notes, and removes its hours from your components.
                                    </p>

                                    <h3 className="text-base font-semibold text-cream mb-2">Delete a bike</h3>
                                    <ul className="list-disc pl-6 space-y-2 body text-muted mb-4">
                                        <li><strong className="text-cream">In the app:</strong> open the Gear tab, tap the bike, tap Delete Bike, then tap Delete to confirm.</li>
                                        <li><strong className="text-cream">On the website:</strong> open <Link to="/gear" className={linkClass}>My Bikes</Link>, open the bike's actions menu and choose Delete bike.</li>
                                    </ul>
                                    <p className="body text-muted mb-4">
                                        This deletes the bike, its components and their service history. Your rides are kept but are no longer linked to that bike.
                                    </p>

                                    <h3 className="text-base font-semibold text-cream mb-2">Remove data imported from Garmin or Strava</h3>
                                    <ul className="list-disc pl-6 space-y-2 body text-muted mb-4">
                                        <li><strong className="text-cream">In the app:</strong> open the Settings tab and, under Connected Services, tap Disconnect next to the provider.</li>
                                        <li><strong className="text-cream">On the website:</strong> open <Link to="/settings?section=data-sources" className={linkClass}>Settings, then Data Sources</Link>, and disconnect the provider.</li>
                                    </ul>
                                    <p className="body text-muted mb-4">
                                        Disconnecting stops new imports and deletes the GPS tracks we imported from that provider. Your rides and their totals stay. Disconnecting WHOOP or Suunto stops new imports from them.
                                    </p>

                                    <h3 className="text-base font-semibold text-cream mb-2">Anything else</h3>
                                    <p className="body text-muted">
                                        To have other data removed, email <a className={linkClass} href={`mailto:${DELETION_EMAIL}`}>{DELETION_EMAIL}</a> and say what you'd like deleted.
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
