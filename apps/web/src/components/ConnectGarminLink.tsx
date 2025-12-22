import { useState } from "react"
import { FaMountain } from "react-icons/fa"

const apiBase =
  (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "") ||
  (import.meta.env.DEV ? "http://localhost:4000" : "")

export default function ConnectGarminLink() {
  const [isConnecting, setIsConnecting] = useState(false)

  const handleConnect = () => {
    try {
      setIsConnecting(true)
      window.location.href = `${apiBase}/auth/garmin/start`
    } catch (err) {
      console.error('Failed to initiate Garmin OAuth:', err)
      alert('Failed to connect to Garmin. Please try again.')
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
          : 'border-[#11A9ED]/50 bg-[#11A9ED]/20 text-[#11A9ED] hover:bg-[#11A9ED]/30 hover:border-[#11A9ED]/70 hover:cursor-pointer'
        }`}
    >
      <FaMountain size={18} />
      <span>{isConnecting ? 'Connecting...' : 'Connect Garmin'}</span>
    </button>
  )
}
