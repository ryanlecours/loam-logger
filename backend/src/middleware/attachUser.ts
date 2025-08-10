import type { RequestHandler } from 'express'
import { prisma } from '../lib/prisma.ts'

export const attachUser: RequestHandler = async (req, res, next) => {
  try {
    // If you already set a signed cookie elsewhere, honor it
    const cookieId = req.signedCookies?.ll_uid as string | undefined
    if (cookieId) {
      const u = await prisma.user.findUnique({
        where: { id: cookieId },
        select: { id: true, email: true, name: true },
      })
      if (u) { req.user = u; return next() }
    }

    // Dev fallback: upsert a mock user
    const dev = await prisma.user.upsert({
      where: { email: 'dev@example.com' },
      update: {},
      create: { email: 'dev@example.com', name: 'Dev User' },
      select: { id: true, email: true, name: true },
    })

    // Set a signed cookie so future requests bind to this user
    res.cookie('ll_uid', dev.id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV !== 'development',
      signed: true,
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    })

    req.user = dev
    next()
  } catch (e) {
    next(e)
  }
}
