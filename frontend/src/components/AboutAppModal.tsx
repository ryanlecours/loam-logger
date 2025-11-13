import { motion } from "motion/react";
import React, { useEffect, useRef, useState } from "react";

/** ---------- Types ---------- */
type ChangelogItem = {
  date: string;            // "2025-11-10"
  version?: string;        // "v0.3.0"
  highlights?: string[];   // badges like ["Dashboard", "Performance"]
  changes: string[];       // lines of what changed
};

type RoadmapItem = {
  title: string;           // "Garmin OAuth"
  note?: string;           // short description
  tag?: "Now" | "Next" | "Later";
};

type AboutAppModalProps = {
  triggerLabel?: string;
  description?: string;
  changelog?: ChangelogItem[];
  roadmap?: RoadmapItem[];
};

/** ---------- Component ---------- */
export default function AboutAppModal({
  triggerLabel = "About this app",
  description = `Loam Logger is a mountain-bike focused ride tracker for analyzing time on each bike, tracking component maintenance and service needs, and trail ride tendencies.`,
  changelog = [
    {
      date: "2025-11-12",
      version: "0.1.0-alpha.4",
      highlights: ["Auth"],
      changes: [
        "Full integration with Google OAuth for user authentication",
      ],
    },
    {
      date: "2025-11-09",
      version: "0.1.0-alpha.3",
      highlights: ["Dashboard", "UI", "Theme"],
      changes: [
        "Refined layout, color theme and typography (Work Sans) for readability",
      ],
    },
    {
      date: "2025-10-30",
      version: "0.1.0-alpha.2",
      highlights: ["Theme"],
      changes: ["Light/Dark theming foundation", "Added Ride Stats Card (1w / 1m / 3m / YTD)"],
    },
    {
      date: "2025-10-30",
      version: "0.1.0-alpha.1",
      highlights: ["API", "Ride Stats"],
      changes: ["Original data schema integration", "Add ride form and ride list"],
    },
  ],
  roadmap = [
    { title: "Garmin OAuth sign-in", note: "User auth via Garmin", tag: "Now" },
    { title: "Garmin ride sync", note: "Distance, elevation, time, HR zones", tag: "Now" },
    { title: "Bike & component wear", note: "Track hours and service intervals", tag: "Next" },
    { title: "Ride tagging & MTB analytics", note: "Surface type, effort, trail style", tag: "Next" },
    { title: "Trail/segment insights", note: "Compare climbs, descents, PR trends", tag: "Later" },
    { title: "Mobile app (React Native)", note: "After web launch", tag: "Later" },
  ],
}: AboutAppModalProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"about" | "new" | "roadmap">("about");
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFocusable = useRef<HTMLButtonElement>(null);

  // body scroll lock
  useEffect(() => {
    document.body.classList.toggle("overflow-hidden", open);
    return () => document.body.classList.remove("overflow-hidden");
  }, [open]);

  // esc + focus trap + arrow key tab switching
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "ArrowLeft") setTab((t) => (t === "roadmap" ? "new" : t === "new" ? "about" : "about"));
      if (e.key === "ArrowRight") setTab((t) => (t === "about" ? "new" : t === "new" ? "roadmap" : "roadmap"));

      if (e.key === "Tab" && dialogRef.current) {
        const n = dialogRef.current.querySelectorAll<HTMLElement>(
          'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'
        );
        if (!n.length) return;
        const first = n[0], last = n[n.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    firstFocusable.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const onBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) setOpen(false);
  };

  /** helpers */
  const badge = (txt: string) => (
    <span key={txt} className="rounded-full border border-black/10 px-2 py-0.5 text-[11px] leading-5 opacity-80 dark:border-white/15">
      {txt}
    </span>
  );

  const RoadmapColumn = ({ label }: { label: "Now" | "Next" | "Later" }) => {
    const items = roadmap.filter((r) => r.tag === label);
    return (
      <section className="space-y-3 ">
        <h4 className="text-xs font-semibold tracking-wide uppercase opacity-70">{label}</h4>
        {items.length === 0 ? (
          <p className="text-sm opacity-70">No items yet.</p>
        ) : (
          items.map((i, idx) => (
            <div key={idx} className="rounded-xl border border-black/10 p-3 dark:border-white/10">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium mx-auto">{i.title}</div>
              </div>
              {i.note && <p className="mt-1 text-xs opacity-75">{i.note}</p>}
            </div>
          ))
        )}
      </section>
    );
  };

  return (
    <>
    <div className="max-w-fit mx-auto">
    <motion.div
          whileHover={{
            scale: 1.1,
            transition: { duration: 0.1 }
          }}
          whileTap={{ scale: 0.9 }}
          transition={{ duration: 0.5 }}
          className="max-w-fit mt-6">
      <button
        type="button"
        onClick={() => { setTab("about"); setOpen(true); }}
        className="btn-secondary inline-flex items-center rounded-2xl border-black/10 px-4 py-2 text-sm font-medium shadow-sm hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-black/30"
      >
        {triggerLabel}
      </button>
      </motion.div>
      </div>

      {open && (
        <div
          onClick={onBackdropClick}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          aria-modal="true"
          role="dialog"
          aria-labelledby="about-title"
        >
          <div
            ref={dialogRef}
            className="w-full max-w-3xl rounded-3xl bg-white p-6 text-neutral-900 shadow-2xl dark:bg-neutral-900 dark:text-neutral-100"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
              <h2 id="about-title" className="text-xl font-semibold">About Loam Logger</h2>
              <button
                ref={firstFocusable}
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-xl px-2 py-1 text-sm hover:bg-black/5 cursor-pointer dark:hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-black/30"
              >
                ✕
              </button>
            </div>

            {/* Tabs */}
            <div className="mt-4">
              <div role="tablist" aria-label="About tabs" className="flex gap-2 rounded-2xl bg-black/[0.04] p-1 dark:bg-white/[0.06]">
                {[
                  { id: "about", label: "About" },
                  { id: "new", label: "What’s New" },
                  { id: "roadmap", label: "Roadmap" },
                ].map(({ id, label }) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={tab === id}
                    aria-controls={`panel-${id}`}
                    onClick={() => setTab(id as any)}
                    className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition ${
                      tab === id
                        ? "bg-white shadow dark:bg-neutral-700"
                        : "cursor-pointer hover:bg-white/70 dark:hover:bg-white/10"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Panels */}
              <div className="mt-4">
                {/* About */}
                {tab === "about" && (
                  <section id="panel-about" role="tabpanel" className="space-y-4">
                    <p className="text-sm leading-6 opacity-90 whitespace-pre-line mx-auto my-6">{description}</p>
                    <div className="grid gap-3 justify-center mx-auto">
                      <div className="w-sm rounded-xl col-span-3  border border-yellow-500 p-3">
                        <div className="text-xs opacity-70">Status</div>
                        <div className="text-sm font-medium">Active development</div>
                      </div>
                      <div className="rounded-xl col-span-3  border border-black/10 p-3 dark:border-white/10">
                        <div className="text-xs opacity-70">Author</div>
                        <div className="text-sm font-medium">Ryan LeCours</div>
                      </div>
                      <a
                        href="https://ryanlecours.dev"
                        target="_blank"
                        rel="noreferrer"
                        className="col-span-3 rounded-xl border border-black/10 p-3 transition hover:bg-black/[0.03] dark:border-white/10 dark:hover:bg-white/[0.06]"
                      >
                        <div className="text-xs opacity-70">More</div>
                        <div className="text-sm font-medium underline underline-offset-4">ryanlecours.dev</div>
                      </a>
                    </div>
                  </section>
                )}

                {/* What's New (changelog cards) */}
                {tab === "new" && (
                  <section id="panel-new" role="tabpanel" className="space-y-4">
                    {changelog.map((entry, i) => (
                      <article key={i} className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            {entry.version && <span className="text-sm font-semibold">{entry.version}</span>}
                            <span className="text-xs opacity-70">{new Date(entry.date).toLocaleDateString()}</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {(entry.highlights ?? []).map(h => badge(h))}
                          </div>
                        </div>
                        <ul className="mt-2 space-y-1">
                          {entry.changes.map((c, idx) => (
                            <li key={idx} className="text-sm leading-6">
                              • {c}
                            </li>
                          ))}
                        </ul>
                      </article>
                    ))}
                  </section>
                )}

                {/* Roadmap (Now / Next / Later) */}
                {tab === "roadmap" && (
                  <section id="panel-roadmap" role="tabpanel" className="grid gap-6 sm:grid-cols-3">
                    <RoadmapColumn label="Now" />
                    <RoadmapColumn label="Next" />
                    <RoadmapColumn label="Later" />
                  </section>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="mt-6 flex items-center justify-end">
              <button
                onClick={() => setOpen(false)}
                className="rounded-2xl bg-black px-4 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90 cursor-pointer dark:bg-white dark:text-black focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-black/30"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
