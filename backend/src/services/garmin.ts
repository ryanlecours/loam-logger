// src/services/garmin.ts
import { prisma } from '../lib/prisma.ts'

const API_BASE = (process.env.GARMIN_API_BASE || '').replace(/\/$/, '')
const TOKEN_URL = process.env.GARMIN_TOKEN_URL || ''
const CLIENT_ID = process.env.GARMIN_CLIENT_ID || ''
const CLIENT_SECRET = process.env.GARMIN_CLIENT_SECRET // optional

// Stored token shape
type TokenRecord = {
  accessToken: string
  refreshToken?: string | null // note: can be undefined, null, or string
  expiresAt: Date
}

async function getToken(userId: string): Promise<TokenRecord | null> {
  const t = await prisma.oauthToken.findUnique({
    where: { userId_provider: { userId, provider: 'garmin' } },
    select: { accessToken: true, refreshToken: true, expiresAt: true },
  })
  return t ?? null
}

function isExpiringSoon(expiresAt: Date, skewSeconds = 60): boolean {
  return Date.now() + skewSeconds * 1000 >= new Date(expiresAt).getTime()
}

/** Update token row; never pass `undefined` for refreshToken */
async function saveToken(userId: string, tok: TokenRecord): Promise<void> {
  const data: Parameters<typeof prisma.oauthToken.update>[0]['data'] = {
    accessToken: tok.accessToken,
    expiresAt: tok.expiresAt,
    // only include the field if you actually want to change it
    ...(tok.refreshToken !== undefined ? { refreshToken: tok.refreshToken } : {}),
  }

  await prisma.oauthToken.update({
    where: { userId_provider: { userId, provider: 'garmin' } },
    data,
  })
}

/** Refresh access token via refresh_token grant (with proper null handling) */
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
    refresh_token?: string // may be omitted
    expires_in?: number
  }
  const j = (await res.json()) as RefreshResp

  // If provider omitted refresh_token, keep the existing one; otherwise use provided (or null).
  const nextRefresh: string | null | undefined =
    j.refresh_token !== undefined ? (j.refresh_token ?? null) : undefined

  const next: TokenRecord = {
    accessToken: j.access_token,
    refreshToken: nextRefresh ?? current.refreshToken ?? null,
    expiresAt: new Date(Date.now() + (j.expires_in ?? 3600) * 1000),
  }

  // Persist without ever sending `undefined`
  await saveToken(userId, { ...next, refreshToken: nextRefresh ?? current.refreshToken ?? null })
  return next
}

/** Get a valid access token, refreshing if needed */
export async function getAccessToken(userId: string): Promise<string> {
  const rec = await getToken(userId)
  if (!rec) throw new Error('No Garmin token for user')

  if (isExpiringSoon(rec.expiresAt)) {
    const refreshed = await refreshAccessToken(userId, rec)
    return refreshed.accessToken
  }
  return rec.accessToken
}

/** Build URL safely */
function buildUrl(path: string, query?: Record<string, string>): string {
  const p = path.startsWith('/') ? path : `/${path}`
  const url = new URL(API_BASE + p)
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  return url.toString()
}

/** GET with one-time 401/403 refresh retry */
export async function apiGet<T>(
  userId: string,
  path: string,
  query?: Record<string, string>
): Promise<T> {
  let token = await getAccessToken(userId)
  let res = await fetch(buildUrl(path, query), {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  })

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

export type GarminActivity = {
  id: string | number
  startTime?: string
  duration?: number
  distance?: number
  elevationGain?: number
}

export async function garminGetActivities(
  userId: string,
  params?: Record<string, string>
): Promise<GarminActivity[]> {
  // adjust path to the real endpoint when you have it
  return apiGet<GarminActivity[]>(userId, '/activities', params)
}
