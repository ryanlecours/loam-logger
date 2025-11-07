const apiBase = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '') || 
                (import.meta.env.DEV ? 'http://localhost:4000' : '')
export default function ConnectGarminLink() {
  return <a href={`${apiBase}/auth/garmin/start`} className="btn">Connect Garmin</a>;
}
