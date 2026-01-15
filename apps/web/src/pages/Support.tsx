import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from 'motion/react';
import { Card } from '../components/ui';

type Category = 'question' | 'feedback' | 'feature' | 'bug';

const CATEGORIES: { value: Category; label: string }[] = [
    { value: 'question', label: 'Question' },
    { value: 'feedback', label: 'Feedback' },
    { value: 'feature', label: 'Feature Request' },
    { value: 'bug', label: 'Bug Report / Issue' },
];

export default function Support() {
    const navigate = useNavigate();
    const [category, setCategory] = useState<Category>('question');
    const [subject, setSubject] = useState('');
    const [message, setMessage] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        const categoryLabel = CATEGORIES.find(c => c.value === category)?.label ?? 'Question';
        const emailSubject = `[${categoryLabel}] ${subject}`;
        const mailtoLink = `mailto:ryan.lecours@loamlogger.app?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(message)}`;

        window.location.href = mailtoLink;
    };

    const isValid = subject.trim().length > 0 && message.trim().length > 0;

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
                                        Need assistance with Loam Logger? Fill out the form below and we'll get back to you as soon as possible.
                                    </p>
                                </section>

                                <form onSubmit={handleSubmit} className="space-y-4">
                                    <div>
                                        <label htmlFor="category" className="block text-sm font-medium text-primary mb-1">
                                            Category
                                        </label>
                                        <select
                                            id="category"
                                            value={category}
                                            onChange={(e) => setCategory(e.target.value as Category)}
                                            className="w-full px-3 py-2 bg-surface border border-app rounded-lg text-primary focus:outline-none focus:ring-2 focus:ring-mint focus:border-transparent"
                                        >
                                            {CATEGORIES.map((cat) => (
                                                <option key={cat.value} value={cat.value}>
                                                    {cat.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    <div>
                                        <label htmlFor="subject" className="block text-sm font-medium text-primary mb-1">
                                            Subject
                                        </label>
                                        <input
                                            type="text"
                                            id="subject"
                                            value={subject}
                                            onChange={(e) => setSubject(e.target.value)}
                                            placeholder="Brief description of your question or issue"
                                            className="w-full px-3 py-2 bg-surface border border-app rounded-lg text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-mint focus:border-transparent"
                                        />
                                    </div>

                                    <div>
                                        <label htmlFor="message" className="block text-sm font-medium text-primary mb-1">
                                            Message
                                        </label>
                                        <textarea
                                            id="message"
                                            value={message}
                                            onChange={(e) => setMessage(e.target.value)}
                                            placeholder="Please provide as much detail as possible..."
                                            rows={6}
                                            className="w-full px-3 py-2 bg-surface border border-app rounded-lg text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-mint focus:border-transparent resize-none"
                                        />
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={!isValid}
                                        className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        Send Message
                                    </button>
                                </form>

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
