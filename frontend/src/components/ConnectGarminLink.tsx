import { useState } from "react"
import { FaMountain } from "react-icons/fa"

type ConnectGarminLinkProps = {
  isLoading: boolean
}

const apiBase =
  (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "") ||
  (import.meta.env.DEV ? "http://localhost:4000" : "")

export default function ConnectGarminLink({ }: ConnectGarminLinkProps) {
  const [showTooltip, setShowTooltip] = useState(false)

  return (
    <div
      className="relative w-full"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <button
        disabled
        className={`flex items-center justify-center gap-3 w-full py-3 rounded-md font-medium transition cursor-not-allowed btn-disabled
        `}
      >
        <FaMountain size={18} className="text-primary" />
        <a href={`${apiBase}/auth/garmin/start`}>Connect Garmin</a>
      </button>

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-20">
          <div className="bg-black text-white text-sm px-3 py-1 rounded-lg shadow-md whitespace-nowrap">
            Coming Soon — Awaiting Garmin API Access
          </div>
          <div className="absolute left-1/2 -translate-x-1/2 top-full border-4 border-transparent border-t-black" />
        </div>
      )}
    </div>
  )
}
