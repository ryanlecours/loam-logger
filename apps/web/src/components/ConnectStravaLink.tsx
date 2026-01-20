import { useState } from "react"
import { FaStrava } from "react-icons/fa"
import { useUserTier } from "../hooks/useUserTier"

const apiBase =
  (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "") ||
  (import.meta.env.DEV ? "http://localhost:4000" : "")

export default function ConnectStravaLink() {
  const [isConnecting, setIsConnecting] = useState(false)
  const { isAdmin } = useUserTier()

  // Strava connections temporarily disabled for non-admin users
  const isStravaDisabled = !isAdmin

  const handleConnect = () => {
    if (isStravaDisabled) return

    try {
      setIsConnecting(true)
      window.location.href = `${apiBase}/auth/strava/start`
    } catch (err) {
      console.error('Failed to initiate Strava OAuth:', err)
      alert('Failed to connect to Strava. Please try again.')
      setIsConnecting(false)
    }
  }

  if (isStravaDisabled) {
    return (
      <div className="w-full">
        <button
          disabled
          className="flex items-center justify-center gap-3 w-full rounded-2xl border px-4 py-3 font-medium transition border-sage-20 bg-surface-2/30 text-muted cursor-not-allowed opacity-60"
        >
          <FaStrava size={18} />
          <span>Strava Temporarily Unavailable</span>
        </button>
        <p className="text-xs text-concrete mt-2 text-center px-2">
          We're awaiting an athlete limit increase from Strava. Connections will be available shortly and you'll receive an email when they're re-enabled.
        </p>
      </div>
    )
  }

  return (
    <button
      onClick={handleConnect}
      disabled={isConnecting}
      className={`flex items-center justify-center gap-3 w-full rounded-2xl border px-4 py-3 font-medium transition
        ${isConnecting
          ? 'border-app/70 bg-surface-2/50 text-muted cursor-wait opacity-50'
          : 'border-[#FC4C02]/50 bg-[#FC4C02]/20 text-[#FC4C02] hover:bg-[#FC4C02]/30 hover:border-[#FC4C02]/70 hover:cursor-pointer'
        }`}
    >
      <FaStrava size={18} />
      <span>{isConnecting ? 'Connecting...' : 'Connect Strava'}</span>
    </button>
  )
}
