// ConnectGarminLink.tsx
const api = import.meta.env.VITE_API_URL || 'http://localhost:4000';
export default function ConnectGarminLink() {
  return <a href={`${api.replace(/\/$/, '')}/auth/garmin/start`} className="btn">Connect Garmin</a>;
}
