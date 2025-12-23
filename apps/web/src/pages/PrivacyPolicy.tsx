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
                                <p className="text-sm text-muted">Last updated: November 13, 2025</p>
                            </div>

                            <div className="max-h-[70vh] overflow-y-auto space-y-6 pr-4">
                                <p className="body">
                                    Loam Logger ("we," "us," or "our") is an application built by Ryan LeCours.
                                    This policy explains what data we collect, how we use it, and your choices.
                                </p>

                                <section>
                                    <h2 className="card-title mb-3">1. Data We Collect</h2>
                                    <ul className="list-disc pl-6 space-y-2 body text-muted">
                                        <li><strong className="text-cream">Account & Auth:</strong> Basic profile info from OAuth providers (e.g., Garmin), such as your name, email, and provider ID.</li>
                                        <li><strong className="text-cream">Fitness Data (when connected):</strong> Rides, distance, elevation, duration, heart rate metrics, activity metadata.</li>
                                        <li><strong className="text-cream">App Usage:</strong> Device/browser info and in-app events for diagnostics and performance.</li>
                                    </ul>
                                </section>

                                <section>
                                    <h2 className="card-title mb-3">2. How We Use Data</h2>
                                    <ul className="list-disc pl-6 space-y-2 body text-muted">
                                        <li>Provide core features (ride import, analytics, bike/component tracking).</li>
                                        <li>Improve reliability, performance, and user experience.</li>
                                        <li>Secure accounts and prevent abuse.</li>
                                    </ul>
                                </section>

                                <section>
                                    <h2 className="card-title mb-3">3. Garmin Data</h2>
                                    <p className="body text-muted">
                                        If you connect Garmin, we access data via Garmin's APIs solely to deliver Loam Logger features.
                                        We do not sell Garmin-derived data. Access is limited to the scopes you approve and can be revoked at any time via Garmin or within Loam Logger.
                                    </p>
                                </section>

                                <section>
                                    <h2 className="card-title mb-3">4. Sharing</h2>
                                    <p className="body text-muted">
                                        We do not sell personal data. We may share with trusted processors (e.g., hosting, analytics) under data-processing terms.
                                        We may disclose if required by law or to protect rights and safety.
                                    </p>
                                </section>

                                <section>
                                    <h2 className="card-title mb-3">5. Retention & Deletion</h2>
                                    <p className="body text-muted">
                                        We retain data while your account is active and as needed for service integrity.
                                        You can request deletion of your account and associated data at any time (see "Contact").
                                        Disconnecting Garmin stops new imports; you may also request removal of previously imported Garmin data.
                                    </p>
                                </section>

                                <section>
                                    <h2 className="card-title mb-3">6. Security</h2>
                                    <p className="body text-muted">
                                        We use industry-standard security controls; however, no method of transmission or storage is 100% secure.
                                    </p>
                                </section>

                                <section>
                                    <h2 className="card-title mb-3">7. Children</h2>
                                    <p className="body text-muted">
                                        Loam Logger is not intended for children under 18. We do not knowingly collect data from children.
                                    </p>
                                </section>

                                <section>
                                    <h2 className="card-title mb-3">8. International Transfers</h2>
                                    <p className="body text-muted">
                                        Data may be processed in the United States or other countries with appropriate safeguards.
                                    </p>
                                </section>

                                <section>
                                    <h2 className="card-title mb-3">9. Changes</h2>
                                    <p className="body text-muted">
                                        We may update this policy. We'll post the new date above and, if material, notify you in-app.
                                    </p>
                                </section>

                                <section>
                                    <h2 className="card-title mb-3">10. Contact</h2>
                                    <p className="body">
                                        Questions or deletion requests: <a className="text-mint hover:text-sage transition-colors underline" href="mailto:ryan.lecours@loamlogger.app">ryan.lecours@loamlogger.app</a>
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
