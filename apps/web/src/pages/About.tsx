import { useNavigate } from "react-router-dom";
import { motion } from 'motion/react';
import { Card } from '../components/ui';

export default function About() {
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
                                <h1 className="section-title mb-2">About Loam Logger</h1>
                            </div>

                            <div className="space-y-6">
                                <section>
                                    <p className="body text-muted">
                                        Loam Logger is built by <strong className="text-cream">Loam Labs LLC</strong>, a company dedicated to
                                        helping cyclists track ride time, plan maintenance, and ride with confidence.
                                    </p>
                                </section>

                                <section>
                                    <h2 className="card-title mb-3">Our Mission</h2>
                                    <p className="body text-muted">
                                        We believe that proper bike maintenance shouldn't be a guessing game. Loam Logger helps you
                                        track every ride, monitor component wear, and stay on top of service intervals so you can
                                        focus on what matters most: the ride.
                                    </p>
                                </section>

                                <section>
                                    <h2 className="card-title mb-3">Built by Riders, for Riders</h2>
                                    <p className="body text-muted">
                                        Loam Logger was created by mountain bikers who understand the importance of keeping your
                                        bike in peak condition. Whether you're a weekend warrior or a seasoned enduro racer,
                                        we've built the tools you need to maintain your equipment and ride with peace of mind.
                                    </p>
                                </section>

                                <section>
                                    <h2 className="card-title mb-3">Contact Us</h2>
                                    <p className="body text-muted">
                                        Have questions or feedback? We'd love to hear from you.
                                    </p>
                                    <p className="body mt-2">
                                        <a
                                            href="mailto:support@loamlogger.app"
                                            className="text-mint hover:text-sage transition-colors underline"
                                        >
                                            support@loamlogger.app
                                        </a>
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
