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
      className={`flex items-center justify-center gap-3 w-full py-3 rounded-md font-medium transition
        ${isConnecting
          ? 'bg-gray-700 text-gray-400 cursor-wait'
          : 'bg-red-600 hover:bg-red-700 text-white'
        }`}
    >
      <FaMountain size={18} />
      <span>{isConnecting ? 'Connecting...' : 'Connect Garmin'}</span>
    </button>
  )
}
