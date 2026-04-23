import { Activity } from "lucide-react"

const apiBase =
  (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "") ||
  (import.meta.env.DEV ? "http://localhost:4000" : "")

// Anchor rather than button+JS — `window.location.href = ...` never throws
// so the prior try/catch was dead code and could leave the button stuck in
// "Connecting...". Anchor navigates natively, supports right-click open in
// new tab, works without JavaScript, and has no stuck state.
export default function ConnectWhoopLink() {
  return (
    <a
      href={`${apiBase}/auth/whoop/start`}
      className="flex items-center justify-center gap-3 w-full rounded-2xl border px-4 py-3 font-medium transition no-underline
        border-[#00FF87]/50 bg-[#00FF87]/10 text-[#00FF87] hover:bg-[#00FF87]/20 hover:border-[#00FF87]/70 hover:cursor-pointer"
    >
      <Activity size={18} />
      <span>Connect WHOOP</span>
    </a>
  )
}
