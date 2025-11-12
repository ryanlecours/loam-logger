import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware, type ExpressContextFunctionArgument } from '@as-integrations/express4';
import { typeDefs } from './graphql/schema.ts';
import { resolvers } from './graphql/resolvers.ts';
import authGarmin from './routes/auth.garmin.ts';
import garminTest from './routes/garmin.test.ts';
import mockGarmin from './routes/mock.garmin.ts';
import { googleRouter, attachUser } from './auth/index.ts';

export type GraphQLContext = {
  req: Request
  res: Response
  user: { id: string; email?: string } | null
}

const startServer = async () => {
  const app = express();

  // Railway / proxies so secure cookies & IPs work right
  app.set('trust proxy', 1);

  app.get('/health', (_req, res) => res.status(200).send('ok'));

  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
  const EXTRA_ORIGINS = (process.env.CORS_EXTRA_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);


  const allowOrigin = (origin?: string | undefined) => {
    if (!origin) return true // SSR/tools/no Origin header
    try {
      const u = new URL(origin)
      const host = u.hostname
      return (
        origin === FRONTEND_URL ||
        origin === 'http://localhost:5173' ||
        EXTRA_ORIGINS.includes(origin) ||
        host.endsWith('.vercel.app')
      )
    } catch {
      return false
    }
  }

  app.use(
    cors({
      origin(origin, cb) {
        if (allowOrigin(origin)) return cb(null, true)
        return cb(new Error(`CORS blocked for origin: ${origin}`))
      },
      credentials: true,
    })
  );

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser(process.env.COOKIE_SECRET || 'dev-secret'));
  app.use(attachUser);

  app.use('/auth', googleRouter); // POST /auth/google/code, /auth/logout
  app.use('/auth', authGarmin);   // Garmin OAuth
  app.use(garminTest);            // test route
  app.use(mockGarmin);            // mock route

  const server = new ApolloServer<GraphQLContext>({ typeDefs, resolvers });
  await server.start();

  app.use(
    '/graphql',
    expressMiddleware(server, {
      context: async ({ req, res }: ExpressContextFunctionArgument): Promise<GraphQLContext> => {
        const legacy = req.user as { id: string; email?: string } | undefined;
        const sess = req.sessionUser as { uid: string; email?: string } | undefined;
        const user = legacy ?? (sess ? { id: sess.uid, email: sess.email } : null);
        return { req, res, user: user ?? null };
      },
    })
  );

  const PORT = Number(process.env.PORT) || 4000;
  const HOST = '0.0.0.0'; // bind to all interfaces for Railway

  app.listen(PORT, HOST, () => {
    console.log(`🚴 LoamLogger backend running on :${PORT} (GraphQL at /graphql)`);
  });

  process.on('SIGTERM', async () => {
    await server.stop();
    process.exit(0);
  });
};

startServer();
