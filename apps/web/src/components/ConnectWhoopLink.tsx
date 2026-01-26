import { useState } from "react"
import { TbActivityHeartbeat } from "react-icons/tb"

const apiBase =
  (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "") ||
  (import.meta.env.DEV ? "http://localhost:4000" : "")

export default function ConnectWhoopLink() {
  const [isConnecting, setIsConnecting] = useState(false)

  const handleConnect = () => {
    try {
      setIsConnecting(true)
      window.location.href = `${apiBase}/auth/whoop/start`
    } catch (err) {
      console.error('Failed to initiate WHOOP OAuth:', err)
      alert('Failed to connect to WHOOP. Please try again.')
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
          : 'border-[#00FF87]/50 bg-[#00FF87]/10 text-[#00FF87] hover:bg-[#00FF87]/20 hover:border-[#00FF87]/70 hover:cursor-pointer'
        }`}
    >
      <TbActivityHeartbeat size={18} />
      <span>{isConnecting ? 'Connecting...' : 'Connect WHOOP'}</span>
    </button>
  )
}
