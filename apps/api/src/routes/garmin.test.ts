import {
  Router as createRouter,
  type Router,
  type Request,
  type Response,
  type RequestHandler,
} from 'express';
import { garminGetActivities } from '../services/garmin';
import { sendUnauthorized, sendSuccess, sendError } from '../lib/api-response';

const r: Router = createRouter();

const requireUser: RequestHandler = (req, res, next) => {
  if (!req.user?.id) {
    sendUnauthorized(res);
    return;
  }
  next();
};

type Params = Record<string, never>;
type Query = { limit?: string; from?: string; to?: string };

r.get<Params, unknown, never, Query>(
  '/me/garmin/activities',
  requireUser,
  async (
    req: Request<Params, unknown, never, Query>,
    res: Response
  ) => {
    try {
      const userId = req.user!.id; // safe after requireUser
      const parsedLimit = Number.isFinite(Number(req.query.limit))
        ? Math.min(100, Math.max(1, Number(req.query.limit)))
        : 5;

      const params: Record<string, string> = { limit: String(parsedLimit) };
      if (req.query.from) params.from = req.query.from;
      if (req.query.to) params.to = req.query.to;

      const data = await garminGetActivities(userId, params);
      sendSuccess(res, data);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch activities';
      sendError(res, 502, msg, 'GARMIN_API_ERROR');
      return;
    }
  }
);

export default r;
