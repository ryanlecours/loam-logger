import { useState } from "react"
import { FaStrava } from "react-icons/fa"

const apiBase =
  (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "") ||
  (import.meta.env.DEV ? "http://localhost:4000" : "")

export default function ConnectStravaLink() {
  const [isConnecting, setIsConnecting] = useState(false)

  const handleConnect = () => {
    try {
      setIsConnecting(true)
      window.location.href = `${apiBase}/auth/strava/start`
    } catch (err) {
      console.error('Failed to initiate Strava OAuth:', err)
      alert('Failed to connect to Strava. Please try again.')
      setIsConnecting(false)
    }
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
