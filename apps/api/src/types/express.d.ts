declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email?: string };
      sessionUser?: { uid: string; email?: string };
      /** Request ID for correlation, set by logging middleware */
      requestId?: string;
      /** pino-http sets this - alias for consistency */
      id?: string;
    }
  }
}

export {};
