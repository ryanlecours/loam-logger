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
