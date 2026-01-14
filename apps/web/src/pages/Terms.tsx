import { useNavigate } from "react-router-dom";
import { motion } from 'motion/react';
import { Card } from '../components/ui';
import { TERMS_TEXT, TERMS_LAST_UPDATED } from '../legal/terms';

export default function Terms() {
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
                                <h1 className="section-title mb-2">Terms &amp; Conditions</h1>
                                <p className="text-sm text-muted">Last updated: {TERMS_LAST_UPDATED}</p>
                            </div>

                            <div className="max-h-[70vh] overflow-y-auto space-y-6 pr-4 prose prose-invert prose-sm max-w-none">
                                <div
                                    className="body text-muted [&_h1]:text-cream [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-4 [&_h2]:text-cream [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-6 [&_h2]:mb-3 [&_h3]:text-cream [&_h3]:text-base [&_h3]:font-medium [&_h3]:mt-4 [&_h3]:mb-2 [&_strong]:text-cream [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1 [&_li]:text-muted [&_p]:mb-3 [&_hr]:border-sage-20 [&_hr]:my-6"
                                    dangerouslySetInnerHTML={{
                                        __html: TERMS_TEXT
                                            .replace(/^# (.+)$/gm, '<h1>$1</h1>')
                                            .replace(/^## (.+)$/gm, '<h2>$1</h2>')
                                            .replace(/^### (.+)$/gm, '<h3>$1</h3>')
                                            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                                            .replace(/^- (.+)$/gm, '<li>$1</li>')
                                            .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
                                            .replace(/^---$/gm, '<hr />')
                                            .replace(/\n\n/g, '</p><p>')
                                            .replace(/^(?!<[hulo]|<hr|<p)(.+)$/gm, '<p>$1</p>')
                                    }}
                                />
                            </div>
                        </div>
                    </Card>
                </motion.div>
            </div>
        </div>
    );
}
