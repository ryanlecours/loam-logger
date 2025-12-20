import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware, type ExpressContextFunctionArgument } from '@as-integrations/express4';
import { typeDefs } from './graphql/schema';
import { resolvers } from './graphql/resolvers';
import authGarmin from './routes/auth.garmin';
import authStrava from './routes/auth.strava';
import webhooksGarmin from './routes/webhooks.garmin';
import webhooksStrava from './routes/webhooks.strava';
import garminBackfill from './routes/garmin.backfill';
import stravaBackfill from './routes/strava.backfill';
import dataSourceRouter from './routes/data-source';
import duplicatesRouter from './routes/duplicates';
import garminTest from './routes/garmin.test';
import mockGarmin from './routes/mock.garmin';
import onboardingRouter from './routes/onboarding';
import waitlistRouter from './routes/waitlist';
import { googleRouter, emailRouter, deleteAccountRouter, attachUser } from './auth/index';
import mobileAuthRouter from './auth/mobile.route';

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
    if (!origin) return true; // SSR/tools/no Origin header
    try {
      const u = new URL(origin);
      const host = u.hostname;

      // Allow configured origins
      if (origin === FRONTEND_URL ||
          origin === 'http://localhost:5173' ||
          EXTRA_ORIGINS.includes(origin) ||
          host.endsWith('.vercel.app')) {
        return true;
      }

      // Allow Expo development URLs (exp://, localhost:8081, etc.)
      if (origin.startsWith('exp://') ||
          origin.startsWith('http://localhost:8081') ||
          origin.startsWith('http://localhost:19000') ||
          origin.startsWith('http://localhost:19006')) {
        return true;
      }

      // Allow custom scheme for mobile app
      if (origin.startsWith('loamlogger://')) {
        return true;
      }

      return false;
    } catch {
      // If origin doesn't parse as URL, check if it's an Expo or custom scheme
      if (origin?.startsWith('exp://') || origin?.startsWith('loamlogger://')) {
        return true;
      }
      return false;
    }
  };

  const corsMw = cors({
    origin(origin, cb) {
      if (allowOrigin(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.use(corsMw);
  app.options('*', corsMw);

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser(process.env.COOKIE_SECRET || 'dev-secret'));
  app.use((req, res, next) => {
  if (req.path === '/graphql' || req.path.startsWith('/auth')) {
    console.log(`[REQ] ${req.method} ${req.path} origin=${req.headers.origin || 'n/a'}`);
  }
  next();
});
  app.use(attachUser);

  app.get('/whoami', (req, res) => {
  res.json({ sessionUser: req.sessionUser ?? null });
});
  
  app.use('/auth', googleRouter);       // POST /auth/google/code, /auth/logout
  app.use('/auth', emailRouter);        // POST /auth/signup, /auth/login
  app.use('/auth', deleteAccountRouter); // DELETE /auth/delete-account
  app.use('/auth', mobileAuthRouter);   // Mobile auth: Google, Apple, Email login + refresh
  app.use('/auth', authGarmin);         // Garmin OAuth
  app.use('/auth', authStrava);         // Strava OAuth
  app.use('/api', garminBackfill);      // Garmin backfill (import historical rides)
  app.use('/api', stravaBackfill);      // Strava backfill (import historical rides)
  app.use('/api', dataSourceRouter);    // Data source preference API
  app.use('/api', duplicatesRouter);    // Duplicate rides management
  app.use('/api', waitlistRouter);      // Beta waitlist signup
  app.use(webhooksGarmin);              // Garmin webhooks (deregistration, permissions, activities)
  app.use(webhooksStrava);              // Strava webhooks (verification, events)
  app.use('/onboarding', onboardingRouter); // POST /onboarding/complete
  app.use(garminTest);            // test route
  app.use(mockGarmin);            // mock route

  const server = new ApolloServer<GraphQLContext>({ typeDefs, resolvers });
  await server.start();

  app.use((req, _res, next) => {
  if (req.path === '/graphql' && req.method === 'POST') {
    console.log('[GraphQL] sessionUser:', req.sessionUser ?? null);
  }
  next();
});

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
