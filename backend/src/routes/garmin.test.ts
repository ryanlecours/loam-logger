import {
  Router as createRouter,
  type Router,
  type Request,
  type Response,
  type RequestHandler,
} from 'express'
import { garminGetActivities } from '../services/garmin.ts'

const r: Router = createRouter()

// ✅ Always return void: send response, then `return;`
const requireUser: RequestHandler = (req, res, next) => {
  if (!req.user?.id) {
    res.status(401).json({ ok: false, error: 'unauthorized' })
    return
  }
  next()
}

type Params = Record<string, never>
type Query = { limit?: string; from?: string; to?: string }
type SuccessBody = { ok: true; data: unknown[] }
type ErrorBody = { ok: false; error: string }

r.get<Params, SuccessBody | ErrorBody, never, Query>(
  '/me/garmin/activities',
  requireUser,
  async (
    req: Request<Params, SuccessBody | ErrorBody, never, Query>,
    res: Response<SuccessBody | ErrorBody>
  ) => {
    try {
      const userId = req.user!.id // safe after requireUser
      const parsedLimit = Number.isFinite(Number(req.query.limit))
        ? Math.min(100, Math.max(1, Number(req.query.limit)))
        : 5

      const params: Record<string, string> = { limit: String(parsedLimit) }
      if (req.query.from) params.from = req.query.from
      if (req.query.to) params.to = req.query.to

      const data = await garminGetActivities(userId, params)
      res.status(200).json({ ok: true, data })
      return
    } catch (e: any) {
      res.status(502).json({ ok: false, error: e?.message ?? 'failed' })
      return
    }
  }
)

export default r
