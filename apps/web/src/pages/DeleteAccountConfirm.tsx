import { useLayoutEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { motion } from 'motion/react';
import { Card } from '../components/ui';

const linkClass = 'text-mint hover:text-sage transition-colors underline';

type Status =
    | { kind: 'ready' }
    | { kind: 'deleting' }
    | { kind: 'deleted' }
    | { kind: 'expired' }
    | { kind: 'invalid' }
    | { kind: 'error'; message: string };

/**
 * Landing page for the emailed account deletion link.
 *
 * Opening the link deletes nothing: mail scanners and link previewers fetch
 * links on arrival, so deletion waits for this page's button, which POSTs the
 * token. The request carries no credentials; the token is the authorization.
 *
 * The token is a live credential for 60 minutes, so it is read once into state
 * and stripped from the address bar before paint. That keeps it out of
 * browser history and Referer headers, and away from session replay. The
 * PostHog sanitizer also redacts `token=` from event URLs.
 */
export default function DeleteAccountConfirm() {
    const [searchParams] = useSearchParams();
    const [token] = useState(() => searchParams.get('token'));
    const [status, setStatus] = useState<Status>(token ? { kind: 'ready' } : { kind: 'invalid' });

    useLayoutEffect(() => {
        const url = new URL(window.location.href);
        if (!url.searchParams.has('token')) return;
        url.searchParams.delete('token');
        // Keep react-router's history state so back/forward still work.
        window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    }, []);

    async function handleConfirm() {
        if (!token) return;
        setStatus({ kind: 'deleting' });
        try {
            const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/delete-account/confirm`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token }),
            });

            if (res.ok) {
                setStatus({ kind: 'deleted' });
                return;
            }

            const data = await res.json().catch(() => ({}));
            if (data.code === 'TOKEN_EXPIRED') {
                setStatus({ kind: 'expired' });
            } else if (data.code === 'TOKEN_INVALID') {
                setStatus({ kind: 'invalid' });
            } else if (res.status === 429) {
                setStatus({ kind: 'error', message: 'Too many attempts. Please wait a minute and try again.' });
            } else {
                setStatus({
                    kind: 'error',
                    message: typeof data.error === 'string' && data.error
                        ? data.error
                        : "Your account could not be deleted. Please try again.",
                });
            }
        } catch {
            setStatus({ kind: 'error', message: 'A network error occurred. Please try again.' });
        }
    }

    return (
        <div className="min-h-screen bg-app py-16 px-6">
            <div className="container max-w-2xl mx-auto">
                <motion.div
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6 }}
                >
                    <Card variant="glass" className="p-8">
                        <div className="space-y-4">
                            {status.kind === 'deleted' ? (
                                <>
                                    <h1 className="title-page">Your account has been deleted</h1>
                                    <p className="body text-muted">
                                        Your Loam Logger account and the data stored with it are gone. Thanks for riding with us.
                                    </p>
                                    <p className="body text-muted">
                                        <Link to="/" className={linkClass}>Go to loamlogger.app</Link>
                                    </p>
                                </>
                            ) : status.kind === 'expired' ? (
                                <>
                                    <h1 className="title-page">This link has expired</h1>
                                    <p className="body text-muted">
                                        Deletion links work for 60 minutes. Your account has not been deleted.
                                    </p>
                                    <p className="body text-muted">
                                        <Link to="/delete-account#by-email" className={linkClass}>Request a new link</Link>
                                    </p>
                                </>
                            ) : status.kind === 'invalid' ? (
                                <>
                                    <h1 className="title-page">This link doesn't work</h1>
                                    <p className="body text-muted">
                                        It may be incomplete, already used, or for an account whose email has since changed. No account was deleted.
                                    </p>
                                    <p className="body text-muted">
                                        <Link to="/delete-account#by-email" className={linkClass}>Request a new link</Link>
                                    </p>
                                </>
                            ) : (
                                <>
                                    <h1 className="title-page">Delete your Loam Logger account?</h1>
                                    <p className="body text-muted">
                                        This permanently deletes your account, bikes, components, service history and rides. It cannot be undone.
                                    </p>
                                    <p className="body text-muted">
                                        If you pay for Loam Logger Pro through the App Store or Google Play, cancel that subscription in the store first. Deleting your account does not cancel it.
                                    </p>
                                    {status.kind === 'error' && (
                                        <p role="alert" className="body text-danger">{status.message}</p>
                                    )}
                                    <div className="flex flex-wrap items-center gap-4 pt-2">
                                        <button
                                            type="button"
                                            onClick={handleConfirm}
                                            disabled={status.kind === 'deleting'}
                                            className="btn-danger disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {status.kind === 'deleting' ? 'Deleting…' : 'Delete my account'}
                                        </button>
                                        <Link to="/" className={linkClass}>Keep my account</Link>
                                    </div>
                                    <p className="text-sm text-muted pt-2">
                                        What is deleted and what is kept is listed on the <Link to="/delete-account#what-is-deleted" className={linkClass}>Delete Your Account</Link> page.
                                    </p>
                                </>
                            )}
                        </div>
                    </Card>
                </motion.div>
            </div>
        </div>
    );
}
