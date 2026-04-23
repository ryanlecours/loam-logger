import { StravaIcon } from './icons/BrandIcons'

const apiBase =
  (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "") ||
  (import.meta.env.DEV ? "http://localhost:4000" : "")

// Anchor rather than button+JS — `window.location.href = ...` never throws
// so the prior try/catch was dead code and could leave the button stuck in
// "Connecting...". Anchor navigates natively, supports right-click open in
// new tab, works without JavaScript, and has no stuck state.
export default function ConnectStravaLink() {
  return (
    <a
      href={`${apiBase}/auth/strava/start`}
      className="flex items-center justify-center gap-3 w-full rounded-2xl border px-4 py-3 font-medium transition no-underline
        border-[#FC4C02]/50 bg-[#FC4C02]/20 text-[#FC4C02] hover:bg-[#FC4C02]/30 hover:border-[#FC4C02]/70 hover:cursor-pointer"
    >
      <StravaIcon size={18} />
      <span>Connect Strava</span>
    </a>
  )
}
