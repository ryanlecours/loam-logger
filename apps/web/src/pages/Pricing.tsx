import { useNavigate } from "react-router-dom";
import { motion } from 'motion/react';
import { Card } from '../components/ui';

export default function Pricing() {
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
                        <div className="space-y-6 text-center py-12">
                            <h1 className="section-title">Pricing</h1>
                            <p className="text-xl text-muted">Coming Soon</p>
                            <p className="body text-muted max-w-md mx-auto">
                                We're working on pricing plans that will help you get the most out of Loam Logger.
                                Stay tuned for updates.
                            </p>
                        </div>
                    </Card>
                </motion.div>
            </div>
        </div>
    );
}
