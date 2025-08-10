// src/services/garmin.ts
import { prisma } from '../lib/prisma.ts'

/**
 * Environment
 * GARMIN_API_BASE      e.g. "https://apis.garmin.com/..." (base URL without trailing slash)
 * GARMIN_TOKEN_URL     OAuth token endpoint
 * GARMIN_CLIENT_ID
 * GARMIN_CLIENT_SECRET (if required by your Garmin app type)
 */
const API_BASE = (process.env.GARMIN_API_BASE || '').replace(/\/$/, '')
const TOKEN_URL = process.env.GARMIN_TOKEN_URL || ''
const CLIENT_ID = process.env.GARMIN_CLIENT_ID || ''
const CLIENT_SECRET = process.env.GARMIN_CLIENT_SECRET // optional depending on app type

if (!API_BASE || !TOKEN_URL || !CLIENT_ID) {
  // Fail fast on boot if desired; or remove this and handle at call sites.
  // console.warn('GARMIN env not fully set (GARMIN_API_BASE, GARMIN_TOKEN_URL, GARMIN_CLIENT_ID).')
}

/** Stored token shape (matches your Prisma model) */
type TokenRecord = {
  accessToken: string
  refreshToken?: string | null
  expiresAt: Date
}

/** Fetch the current token record for the user/provider=garmin */
async function getToken(userId: string): Promise<TokenRecord | null> {
  const t = await prisma.oauthToken.findUnique({
    where: { userId_provider: { userId, provider: 'garmin' } },
    select: { accessToken: true, refreshToken: true, expiresAt: true },
  })
  return t ?? null
}

/** Save/overwrite the token after refresh */
async function saveToken(userId: string, tok: TokenRecord): Promise<void> {
  await prisma.oauthToken.update({
    where: { userId_provider: { userId, provider: 'garmin' } },
    data: {
      accessToken: tok.accessToken,
      refreshToken: tok.refreshToken ?? undefined,
      expiresAt: tok.expiresAt,
    },
  })
}

/** True if token is expiring within N seconds */
function isExpiringSoon(expiresAt: Date, skewSeconds = 60): boolean {
  return Date.now() + skewSeconds * 1000 >= new Date(expiresAt).getTime()
}

/** Refresh access token via refresh_token grant */
async function refreshAccessToken(userId: string, current: TokenRecord): Promise<TokenRecord> {
  if (!current.refreshToken) {
    throw new Error('No refresh token available')
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: current.refreshToken,
    client_id: CLIENT_ID,
  })
  if (CLIENT_SECRET) body.set('client_secret', CLIENT_SECRET)

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Garmin refresh failed: ${res.status} ${txt}`)
  }

  type RefreshResp = {
    access_token: string
    refresh_token?: string
    expires_in?: number
    token_type?: string
    scope?: string
  }
  const j = (await res.json()) as RefreshResp
  const next: TokenRecord = {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? current.refreshToken ?? null,
    expiresAt: new Date(Date.now() + (j.expires_in ?? 3600) * 1000),
  }
  await saveToken(userId, next)
  return next
}

/**
 * Get a valid access token, refreshing if needed.
 * Throws if user has no token stored yet.
 */
export async function getAccessToken(userId: string): Promise<string> {
  const rec = await getToken(userId)
  if (!rec) throw new Error('No Garmin token for user')

  if (isExpiringSoon(rec.expiresAt)) {
    const refreshed = await refreshAccessToken(userId, rec)
    return refreshed.accessToken
  }
  return rec.accessToken
}

/** Join API base + path + query safely */
function buildUrl(path: string, query?: Record<string, string>): string {
  const p = path.startsWith('/') ? path : `/${path}`
  const url = new URL(API_BASE + p)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null) url.searchParams.set(k, String(v))
    }
  }
  return url.toString()
}

/** Low-level GET with auto-refresh-on-401 retry */
export async function apiGet<T>(
  userId: string,
  path: string,
  query?: Record<string, string>
): Promise<T> {
  let token = await getAccessToken(userId)
  let res = await fetch(buildUrl(path, query), {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  })

  // If unauthorized, try one refresh and retry once
  if (res.status === 401 || res.status === 403) {
    const rec = await getToken(userId)
    if (rec) {
      const refreshed = await refreshAccessToken(userId, rec)
      token = refreshed.accessToken
      res = await fetch(buildUrl(path, query), {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      })
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Garmin API error ${res.status}: ${text}`)
  }
  return (await res.json()) as T
}

/** Example response shape (adjust once you know Garmin’s fields) */
export type GarminActivity = {
  id: string | number
  startTime?: string
  duration?: number
  distance?: number
  elevationGain?: number
  // ...add more as needed
}

/** High-level helper used by your test route */
export async function garminGetActivities(
  userId: string,
  params?: Record<string, string>
): Promise<GarminActivity[]> {
  // Update the path to whatever Garmin’s activities endpoint is for your app scope
  return apiGet<GarminActivity[]>(userId, '/activities', params)
}
