// src/routes/auth.garmin.ts
import { Router as createRouter, type Router, type Request, type Response } from 'express'
import { prisma } from '../lib/prisma.ts'
import { sha256, randomString } from '../lib/pcke.ts'
import { addSeconds } from 'date-fns'

type Empty = Record<string, never>

const r: Router = createRouter()

/**
 * 1) Start OAuth — redirect user to Garmin’s consent page with PKCE + state
 */
r.get<Empty, void, Empty>('/auth/garmin/start', async (_req: Request, res: Response) => {
  const state = randomString(24)
  const verifier = randomString(64)
  const challenge = await sha256(verifier)

  // short-lived, httpOnly cookies for PKCE + CSRF state
  res.cookie('ll_oauth_state', state, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV !== 'development', maxAge: 10 * 60 * 1000, path: '/'
  })
  res.cookie('ll_pkce_verifier', verifier, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV !== 'development', maxAge: 10 * 60 * 1000, path: '/'
  })

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.GARMIN_CLIENT_ID!,
    redirect_uri: process.env.GARMIN_REDIRECT_URI!,
    scope: process.env.GARMIN_SCOPES ?? '',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  })

  const url = `${process.env.GARMIN_AUTH_URL}?${params.toString()}`
  return res.redirect(url)
})

/**
 * 2) Callback — exchange code for tokens, store in DB, done.
 */
r.get<Empty, void, Empty, { code?: string; state?: string }>(
  '/auth/garmin/callback',
  async (req: Request<Empty, void, Empty, { code?: string; state?: string }>, res: Response) => {
    const { code, state } = req.query
    const cookieState = req.cookies['ll_oauth_state']
    const verifier = req.cookies['ll_pkce_verifier']

    if (!code || !state || !cookieState || state !== cookieState || !verifier) {
      return res.status(400).send('Invalid OAuth state/PKCE')
    }
    if (!req.user?.id) {
      return res.status(401).send('No user')
    }

    // Token exchange (OAuth2 Authorization Code + PKCE)
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.GARMIN_REDIRECT_URI!,
      client_id: process.env.GARMIN_CLIENT_ID!,
      code_verifier: verifier
    })
    // Some providers require client_secret here (confidential client):
    if (process.env.GARMIN_CLIENT_SECRET) {
      body.set('client_secret', process.env.GARMIN_CLIENT_SECRET)
    }

    const tokenRes = await fetch(process.env.GARMIN_TOKEN_URL!, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    })

    if (!tokenRes.ok) {
      const text = await tokenRes.text()
      return res.status(502).send(`Token exchange failed: ${text}`)
    }

    type TokenResp = {
      access_token: string
      refresh_token?: string
      expires_in?: number
      token_type?: string
      scope?: string
    }
    const t = (await tokenRes.json()) as TokenResp;
    const expiresAt = addSeconds(new Date(), t.expires_in ?? 3600)

    await prisma.oauthToken.upsert({
      where: { userId_provider: { userId: req.user.id, provider: 'garmin' } },
      create: {
        userId: req.user.id,
        provider: 'garmin',
        accessToken: t.access_token,
        refreshToken: t.refresh_token,
        expiresAt
      },
      update: {
        accessToken: t.access_token,
        refreshToken: t.refresh_token,
        expiresAt
      }
    })

    // Clear PKCE cookies and redirect back to app
    res.clearCookie('ll_oauth_state', { path: '/' })
    res.clearCookie('ll_pkce_verifier', { path: '/' })

    // send them to your dashboard; or return JSON if you prefer SPA handoff
    return res.redirect(`${process.env.APP_BASE_URL!.replace(/\/$/, '')}/auth/complete`);
  }
)

export default r
