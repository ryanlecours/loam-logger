import { SuuntoIcon } from './icons/BrandIcons'

const apiBase =
  (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "") ||
  (import.meta.env.DEV ? "http://localhost:4000" : "")

// Rendered as an anchor rather than a button+JS navigation. The previous
// button-driven version used `window.location.href = ...` wrapped in a
// try/catch, but assigning to `location.href` never throws, so the catch
// was dead code — if navigation was blocked, the "Connecting..." state
// would stick forever. An anchor: navigates natively, supports right-click
// "open in new tab", works without JavaScript, and has no stuck state.
export default function ConnectSuuntoLink() {
  return (
    <a
      href={`${apiBase}/auth/suunto/start`}
      className="flex items-center justify-center gap-3 w-full rounded-2xl border px-4 py-3 font-medium transition no-underline
        border-[#0072CE]/50 bg-[#0072CE]/20 text-[#0072CE] hover:bg-[#0072CE]/30 hover:border-[#0072CE]/70 hover:cursor-pointer"
    >
      <SuuntoIcon size={18} />
      <span>Connect Suunto</span>
    </a>
  )
}
