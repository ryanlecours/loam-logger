import { FaMountain } from "react-icons/fa";

type ConnectGarminLinkProps = {
  isLoading: boolean
}

const apiBase = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '') || 
                (import.meta.env.DEV ? 'http://localhost:4000' : '')
export default function ConnectGarminLink({isLoading}: ConnectGarminLinkProps) {
  return <button className={`flex items-center justify-center gap-3 w-full py-3 rounded-md font-medium transition ${
            isLoading
              ? 'btn-disabled'
              : 'btn-primary hover:btn-primary-dark focus:btn-primary-dark'
          }`}>
          <FaMountain size={18} className="text-primary" /><a href={`${apiBase}/auth/garmin/start`} >Connect Garmin</a></button>;
}
