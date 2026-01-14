import { useNavigate } from "react-router-dom";
import { motion } from 'motion/react';
import { Card } from '../components/ui';

export default function Disclaimer() {
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
                                <h1 className="section-title mb-2">Safety &amp; Estimates Disclaimer</h1>
                            </div>

                            <div className="space-y-6">
                                <section>
                                    <h2 className="card-title mb-3">Important Notice</h2>
                                    <p className="body text-muted">
                                        Loam Logger provides maintenance estimates and tracking tools to help you organize
                                        your bicycle maintenance schedule. These estimates are <strong className="text-cream">informational only</strong> and
                                        should not be used as a substitute for professional inspection or manufacturer recommendations.
                                    </p>
                                </section>

                                <section>
                                    <h2 className="card-title mb-3">Estimates Are Not Guarantees</h2>
                                    <p className="body text-muted">
                                        All maintenance intervals, wear estimates, and service reminders provided by Loam Logger are based on
                                        generalized assumptions, user-provided data, and statistical averages. Actual component wear and
                                        maintenance needs vary significantly based on:
                                    </p>
                                    <ul className="list-disc pl-6 space-y-2 body text-muted mt-3">
                                        <li>Riding style, terrain, and conditions</li>
                                        <li>Rider weight and skill level</li>
                                        <li>Component quality and manufacturing variance</li>
                                        <li>Bike setup and configuration</li>
                                        <li>Environmental factors and storage conditions</li>
                                        <li>Previous crashes or impacts</li>
                                    </ul>
                                </section>

                                <section>
                                    <h2 className="card-title mb-3">Professional Inspection Required</h2>
                                    <p className="body text-muted">
                                        Components may fail <strong className="text-cream">without warning</strong>, regardless of estimated service intervals.
                                        You should always have your bicycle inspected by a qualified professional mechanic before riding,
                                        especially if you notice any unusual behavior, sounds, or performance changes.
                                    </p>
                                </section>

                                <section>
                                    <h2 className="card-title mb-3">Your Responsibility</h2>
                                    <p className="body text-muted">
                                        By using Loam Logger, you acknowledge that you are solely responsible for:
                                    </p>
                                    <ul className="list-disc pl-6 space-y-2 body text-muted mt-3">
                                        <li>Inspecting your bicycle before every ride</li>
                                        <li>Maintaining your bicycle in a safe and functional condition</li>
                                        <li>Following manufacturer service recommendations</li>
                                        <li>Consulting qualified professionals for inspection and repair</li>
                                        <li>Determining when maintenance, service, repair, or replacement is required</li>
                                    </ul>
                                </section>

                                <section>
                                    <h2 className="card-title mb-3">Assumption of Risk</h2>
                                    <p className="body text-muted">
                                        Cycling is inherently dangerous and involves risk of serious injury, death, or property damage.
                                        By using Loam Logger, you voluntarily assume all risks associated with riding, maintaining, and
                                        operating your bicycle.
                                    </p>
                                </section>

                                <section className="pt-4 border-t border-app">
                                    <p className="text-sm text-muted">
                                        For complete legal terms, please review our <a href="/terms" className="text-mint hover:text-sage transition-colors underline">Terms &amp; Conditions</a>.
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
