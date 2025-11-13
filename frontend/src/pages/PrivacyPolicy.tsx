import { useNavigate } from "react-router-dom";

export default function PrivacyPolicy() {
    const navigate = useNavigate();
    return (
        <main className="mx-auto max-w-6xl px-6 py-10">
            {/* Back button */}
            <button
                onClick={() => navigate("/")}
                className="absolute top-6 left-6 inline-flex cursor-pointer items-center gap-2 rounded-xl border border-black/10 px-3 py-2 text-sm font-medium text-black/80 shadow-sm hover:bg-black/5 dark:border-white/10 dark:text-white/80 dark:hover:bg-white/10"
            >
                ← Back
            </button>
            <h1 className="text-2xl font-semibold">Privacy Policy</h1>
            <p className="mt-2 text-sm opacity-70">Last updated: November 13, 2025</p>

            <section className="mt-6 space-y-4 max-h-[90vh] text-sm leading-6 overflow-y-auto">
                <p>
                    Loam Logger (“we,” “us,” or “our”) is an application built by Ryan LeCours.
                    This policy explains what data we collect, how we use it, and your choices.
                </p>

                <h2 className="mt-6 text-base font-semibold">1. Data We Collect</h2>
                <ul className="list-disc pl-5">
                    <li><strong>Account & Auth:</strong> Basic profile info from OAuth providers (e.g., Garmin), such as your name, email, and provider ID.</li>
                    <li><strong>Fitness Data (when connected):</strong> Rides, distance, elevation, duration, heart rate metrics, activity metadata.</li>
                    <li><strong>App Usage:</strong> Device/browser info and in-app events for diagnostics and performance.</li>
                </ul>

                <h2 className="mt-6 text-base font-semibold">2. How We Use Data</h2>
                <ul className="list-disc pl-5">
                    <li>Provide core features (ride import, analytics, bike/component tracking).</li>
                    <li>Improve reliability, performance, and user experience.</li>
                    <li>Secure accounts and prevent abuse.</li>
                </ul>

                <h2 className="mt-6 text-base font-semibold">3. Garmin Data</h2>
                <p>
                    If you connect Garmin, we access data via Garmin’s APIs solely to deliver Loam Logger features.
                    We do not sell Garmin-derived data. Access is limited to the scopes you approve and can be revoked at any time via Garmin or within Loam Logger.
                </p>

                <h2 className="mt-6 text-base font-semibold">4. Sharing</h2>
                <p>
                    We do not sell personal data. We may share with trusted processors (e.g., hosting, analytics) under data-processing terms.
                    We may disclose if required by law or to protect rights and safety.
                </p>

                <h2 className="mt-6 text-base font-semibold">5. Retention & Deletion</h2>
                <p>
                    We retain data while your account is active and as needed for service integrity.
                    You can request deletion of your account and associated data at any time (see “Contact”).
                    Disconnecting Garmin stops new imports; you may also request removal of previously imported Garmin data.
                </p>

                <h2 className="mt-6 text-base font-semibold">6. Security</h2>
                <p>
                    We use industry-standard security controls; however, no method of transmission or storage is 100% secure.
                </p>

                <h2 className="mt-6 text-base font-semibold">7. Children</h2>
                <p>
                    Loam Logger is not intended for children under 18. We do not knowingly collect data from children.
                </p>

                <h2 className="mt-6 text-base font-semibold">8. International Transfers</h2>
                <p>
                    Data may be processed in the United States or other countries with appropriate safeguards.
                </p>

                <h2 className="mt-6 text-base font-semibold">9. Changes</h2>
                <p>
                    We may update this policy. We’ll post the new date above and, if material, notify you in-app.
                </p>

                <h2 className="mt-6 text-base font-semibold">10. Contact</h2>
                <p>
                    Questions or deletion requests: <a className="underline" href="mailto:ryan.lecours@loamlogger.app">ryan.lecours@loamlogger.app</a>
                </p>
            </section>
        </main>
    );
}
