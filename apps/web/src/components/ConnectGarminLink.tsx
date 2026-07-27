import GarminConnectMark from "./attribution/GarminConnectMark"
import { GARMIN_CONNECT_APP_NAME } from "@loam/shared"

const apiBase =
  (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "") ||
  (import.meta.env.DEV ? "http://localhost:4000" : "")

// Anchor rather than button+JS — `window.location.href = ...` never throws
// so the prior try/catch was dead code and could leave the button stuck in
// "Connecting...". Anchor navigates natively, supports right-click open in
// new tab, works without JavaScript, and has no stuck state.
//
// Mark + full app name per the Garmin API Brand Guidelines' AUTHENTICATING
// APPLICATIONS rule. This previously rendered a lucide `Mountain` glyph and the
// truncated label "Connect Garmin", which the guidelines disallow on both
// counts. Brand color comes from the --brand-garmin token rather than an
// inline hex so the three values that used to be in circulation stay unified.
export default function ConnectGarminLink() {
  return (
    <a href={`${apiBase}/auth/garmin/start`} className="btn-connect-garmin">
      <GarminConnectMark size={20} />
      <span>Connect {GARMIN_CONNECT_APP_NAME}</span>
    </a>
  )
}
