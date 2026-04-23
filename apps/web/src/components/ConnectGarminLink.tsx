import { Mountain } from "lucide-react"

const apiBase =
  (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "") ||
  (import.meta.env.DEV ? "http://localhost:4000" : "")

// Anchor rather than button+JS — `window.location.href = ...` never throws
// so the prior try/catch was dead code and could leave the button stuck in
// "Connecting...". Anchor navigates natively, supports right-click open in
// new tab, works without JavaScript, and has no stuck state.
export default function ConnectGarminLink() {
  return (
    <a
      href={`${apiBase}/auth/garmin/start`}
      className="flex items-center justify-center gap-3 w-full rounded-2xl border px-4 py-3 font-medium transition no-underline
        border-[#11A9ED]/50 bg-[#11A9ED]/20 text-[#11A9ED] hover:bg-[#11A9ED]/30 hover:border-[#11A9ED]/70 hover:cursor-pointer"
    >
      <Mountain size={18} />
      <span>Connect Garmin</span>
    </a>
  )
}
