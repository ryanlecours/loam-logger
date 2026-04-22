import { useState } from "react"
import { SuuntoIcon } from './icons/BrandIcons'

const apiBase =
  (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "") ||
  (import.meta.env.DEV ? "http://localhost:4000" : "")

export default function ConnectSuuntoLink() {
  const [isConnecting, setIsConnecting] = useState(false)

  const handleConnect = () => {
    try {
      setIsConnecting(true)
      window.location.href = `${apiBase}/auth/suunto/start`
    } catch (err) {
      console.error('Failed to initiate Suunto OAuth:', err)
      alert('Failed to connect to Suunto. Please try again.')
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
          : 'border-[#0072CE]/50 bg-[#0072CE]/20 text-[#0072CE] hover:bg-[#0072CE]/30 hover:border-[#0072CE]/70 hover:cursor-pointer'
        }`}
    >
      <SuuntoIcon size={18} />
      <span>{isConnecting ? 'Connecting...' : 'Connect Suunto'}</span>
    </button>
  )
}
