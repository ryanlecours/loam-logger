declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email?: string };
      sessionUser?: { uid: string; email?: string };
    }
  }
}

export {};
