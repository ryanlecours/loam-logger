/** Auth error codes thrown by ensureUser* helpers and matched in route handlers */
export const AUTH_ERROR = {
  CLOSED_BETA: 'CLOSED_BETA',
  ALREADY_ON_WAITLIST: 'ALREADY_ON_WAITLIST',
} as const;

export type GoogleClaims = {
  sub: string
  email?: string
  email_verified?: boolean
  name?: string | null
  picture?: string | null
}

export type GoogleTokens = {
  id_token: string
  access_token?: string
  refresh_token?: string
  expires_in?: number
}

export type AppleClaims = {
  sub: string
  email?: string
  /** Normalized to boolean by the route handler (Apple sends string "true"/"false" in the identity token) */
  email_verified?: boolean
  name?: string | null
}
