import { useNavigate } from "react-router-dom";
import { motion } from 'motion/react';
import { Card } from '../components/ui';

export default function Support() {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-app py-16 px-6">
            <div className="container max-w-4xl mx-auto">
                <motion.div
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6 }}
                >
                    <button
                        onClick={() => navigate(-1)}
                        className="btn-secondary mb-6 inline-flex items-center gap-2"
                    >
                        &larr; Back
                    </button>

                    <Card variant="glass" className="p-8">
                        <div className="space-y-6">
                            <div>
                                <h1 className="section-title mb-2">Support</h1>
                            </div>

                            <div className="space-y-6">
                                <section>
                                    <h2 className="card-title mb-3">Get Help</h2>
                                    <p className="body text-muted">
                                        Need assistance with Loam Logger? We're here to help. Reach out to our support team
                                        and we'll get back to you as soon as possible.
                                    </p>
                                </section>

                                <section>
                                    <h2 className="card-title mb-3">Contact Us</h2>
                                    <p className="body text-muted mb-4">
                                        For questions, feedback, or technical support, please email us at:
                                    </p>
                                    <a
                                        href="mailto:support@loamlogger.app"
                                        className="btn-primary inline-flex items-center gap-2"
                                    >
                                        support@loamlogger.app
                                    </a>
                                </section>

                                <section>
                                    <h2 className="card-title mb-3">Common Topics</h2>
                                    <ul className="list-disc pl-6 space-y-2 body text-muted">
                                        <li>Account and login issues</li>
                                        <li>Connecting fitness platforms (Garmin, Strava, etc.)</li>
                                        <li>Importing ride data and GPX files</li>
                                        <li>Managing bikes and components</li>
                                        <li>Understanding maintenance estimates</li>
                                        <li>Feature requests and feedback</li>
                                    </ul>
                                </section>

                                <section className="pt-4 border-t border-app">
                                    <p className="text-sm text-muted">
                                        For legal inquiries, please review our <a href="/terms" className="text-mint hover:text-sage transition-colors underline">Terms &amp; Conditions</a> and <a href="/privacy" className="text-mint hover:text-sage transition-colors underline">Privacy Policy</a>.
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
