import type { SessionUser } from '../auth/session';

declare global {
  namespace Express {
    interface Request {
      sessionUser?: SessionUser
    }
  }
}
