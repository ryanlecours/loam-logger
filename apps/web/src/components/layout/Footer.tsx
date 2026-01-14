import { Link } from 'react-router-dom';

const productLinks = [
    { label: 'Dashboard', path: '/dashboard' },
    { label: 'My Bikes', path: '/gear' },
    { label: 'Maintenance', path: '/gear' },
    { label: 'Pricing', path: '/pricing' },
];

const legalLinks = [
    { label: 'Terms & Conditions', path: '/terms' },
    { label: 'Privacy Policy', path: '/privacy' },
    { label: 'Safety & Estimates Disclaimer', path: '/disclaimer' },
];

const companyLinks = [
    { label: 'About', path: '/about' },
    { label: 'Support', path: '/support' },
];

export default function Footer() {
    const currentYear = new Date().getFullYear();

    return (
        <footer className="border-t footer-border">
            <div className="container py-10 px-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
                    {/* Brand Section */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <img
                                src="/web-app-manifest-192x192.png"
                                alt="Loam Logger"
                                className="w-10 h-10 rounded-lg"
                            />
                            <span className="text-xl font-bold text-cream">Loam Logger</span>
                        </div>
                        <p className="text-sm text-concrete leading-relaxed">
                            Track ride time. Plan maintenance. Ride with confidence.
                        </p>
                        <div className="space-y-1 pt-2">
                            <p className="text-xs text-concrete">
                                &copy; {currentYear} Loam Logger
                            </p>
                            <p className="text-xs text-concrete">
                                Built by Loam Labs LLC
                            </p>
                        </div>
                    </div>

                    {/* Product Section */}
                    <nav aria-label="Product links">
                        <h4 className="text-sm font-semibold uppercase tracking-wider text-sage mb-4">
                            Product
                        </h4>
                        <ul className="space-y-2">
                            {productLinks.map(({ label, path }) => (
                                <li key={label}>
                                    <Link
                                        to={path}
                                        className="text-sm text-concrete hover:text-mint transition-colors focus-visible:outline-none focus-visible:text-mint"
                                    >
                                        {label}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </nav>

                    {/* Legal Section */}
                    <nav aria-label="Legal links">
                        <h4 className="text-sm font-semibold uppercase tracking-wider text-sage mb-4">
                            Legal
                        </h4>
                        <ul className="space-y-2">
                            {legalLinks.map(({ label, path }) => (
                                <li key={label}>
                                    <Link
                                        to={path}
                                        className="text-sm text-concrete hover:text-mint transition-colors focus-visible:outline-none focus-visible:text-mint"
                                    >
                                        {label}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </nav>

                    {/* Company Section */}
                    <nav aria-label="Company links">
                        <h4 className="text-sm font-semibold uppercase tracking-wider text-sage mb-4">
                            Company
                        </h4>
                        <ul className="space-y-2">
                            {companyLinks.map(({ label, path }) => (
                                <li key={label}>
                                    <Link
                                        to={path}
                                        className="text-sm text-concrete hover:text-mint transition-colors focus-visible:outline-none focus-visible:text-mint"
                                    >
                                        {label}
                                    </Link>
                                </li>
                            ))}
                            <li>
                                <a
                                    href="mailto:support@loamlogger.app"
                                    className="text-sm text-concrete hover:text-mint transition-colors focus-visible:outline-none focus-visible:text-mint"
                                >
                                    support@loamlogger.app
                                </a>
                            </li>
                        </ul>
                    </nav>
                </div>
            </div>

            {/* Bottom Disclaimer Bar */}
            <div className="border-t footer-border">
                <div className="container py-4 px-6">
                    <p className="text-xs text-center text-concrete">
                        Maintenance estimates are informational only and do not replace professional inspection or manufacturer recommendations.
                    </p>
                </div>
            </div>
        </footer>
    );
}
