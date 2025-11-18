import { useState } from "react";
import ThemeToggle from "../components/ThemeToggleButton";
import { useCurrentUser } from "../hooks/useCurrentUser";

const accountProviders = [
  { name: "Google", description: "Sync rides from your Google-connected services" },
  { name: "Garmin", description: "Import Garmin Connect activities automatically" },
  { name: "Suunto", description: "Bring in data from Suunto wearables" },
];

export default function Settings() {
  const { user } = useCurrentUser();
  const [hoursDisplay, setHoursDisplay] = useState<"total" | "remaining">("total");

  return (
    <div className="space-y-8">
      <section className="panel-soft shadow-soft border border-app rounded-3xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted">Settings</p>
            <h1 className="text-3xl font-semibold text-white">Tune Loam Logger to your workflow</h1>
            <p className="text-sm text-muted max-w-2xl">
              Manage account links, display preferences, and appearance so ride data flows exactly the way you want.
            </p>
          </div>
          <ThemeToggle />
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="panel-soft shadow-soft border border-app rounded-3xl p-6 space-y-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted">Account Linking</p>
            <h2 className="text-xl font-semibold text-white">Connect services</h2>
          </div>
          <div className="space-y-3">
            {accountProviders.map((provider) => (
              <button
                key={provider.name}
                className="w-full rounded-2xl border border-app/70 bg-surface-2 px-4 py-3 text-left transition hover:border-primary/60"
                type="button"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-semibold">{`Link ${provider.name} Account`}</p>
                    <p className="text-sm text-muted">{provider.description}</p>
                  </div>
                  <span className="text-sm text-primary">Connect</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="panel-soft shadow-soft border border-app rounded-3xl p-6 space-y-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted">Profile</p>
            <h2 className="text-xl font-semibold text-white">Your info</h2>
          </div>
          <dl className="grid gap-4 text-sm">
            <div>
              <dt className="text-muted uppercase tracking-[0.3em] text-xs">Name</dt>
              <dd className="text-lg text-white">{user?.name ?? "Unknown rider"}</dd>
            </div>
            <div>
              <dt className="text-muted uppercase tracking-[0.3em] text-xs">Email</dt>
              <dd className="text-lg text-white">{user?.email ?? "—"}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="panel-soft shadow-soft border border-app rounded-3xl p-6 space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-muted">Preferences</p>
          <h2 className="text-xl font-semibold text-white">Component hours display</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label
            className={`cursor-pointer rounded-2xl border px-4 py-3 transition ${
              hoursDisplay === "total"
                ? "border-primary/60 bg-surface-accent/60"
                : "border-app/60 bg-surface-2"
            }`}
          >
            <input
              type="radio"
              name="hours-mode"
              value="total"
              className="mr-2"
              checked={hoursDisplay === "total"}
              onChange={() => setHoursDisplay("total")}
            />
            Show cumulative hours (e.g. 780h / 800h)
          </label>
          <label
            className={`cursor-pointer rounded-2xl border px-4 py-3 transition ${
              hoursDisplay === "remaining"
                ? "border-primary/60 bg-surface-accent/60"
                : "border-app/60 bg-surface-2"
            }`}
          >
            <input
              type="radio"
              name="hours-mode"
              value="remaining"
              className="mr-2"
              checked={hoursDisplay === "remaining"}
              onChange={() => setHoursDisplay("remaining")}
            />
            Show time until next service (e.g. 0h / 50h)
          </label>
        </div>
        <p className="text-xs text-muted">
          Total hours are always stored. This preference only affects how we display service intervals.
        </p>
      </section>
    </div>
  );
}
