import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware, type ExpressContextFunctionArgument } from '@as-integrations/express4';
import { typeDefs } from './graphql/schema';
import { resolvers } from './graphql/resolvers';
import { startWorkers, stopWorkers } from './workers';
import { getRedisConnection, checkRedisHealth } from './lib/redis';

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
import adminRouter from './routes/admin';
import { googleRouter, emailRouter, deleteAccountRouter, attachUser } from './auth/index';
import mobileAuthRouter from './auth/mobile.route';

export type GraphQLContext = {
  req: Request;
  res: Response;
  user: { id: string; email?: string } | null;
};

const startServer = async () => {
  const app = express();

  // Railway / proxies so secure cookies & IPs work right
  app.set('trust proxy', 1);

  // Basic health / diagnostics
  app.get('/health', (_req, res) => res.status(200).send('ok'));

  // Detailed health check including Redis status
  app.get('/health/detailed', async (_req, res) => {
    const redisHealth = await checkRedisHealth();
    const healthy = redisHealth.healthy;

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'healthy' : 'degraded',
      redis: redisHealth,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/whoami', (req, res) => {
    res.json({ sessionUser: req.sessionUser ?? null });
  });

  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
  const EXTRA_ORIGINS = (process.env.CORS_EXTRA_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const allowOrigin = (origin?: string) => {
    if (!origin) return true; // SSR/tools/no Origin header

    // Allow Expo/custom schemes quickly (these are not valid URLs for new URL())
    if (origin.startsWith('exp://') || origin.startsWith('loamlogger://')) return true;

    try {
      const u = new URL(origin);
      const host = u.hostname;

      if (
        origin === FRONTEND_URL ||
        origin === 'http://localhost:5173' ||
        EXTRA_ORIGINS.includes(origin) ||
        host.endsWith('.vercel.app')
      ) {
        return true;
      }

      // Local RN dev servers (http only)
      if (
        origin.startsWith('http://localhost:8081') ||
        origin.startsWith('http://localhost:19000') ||
        origin.startsWith('http://localhost:19006')
      ) {
        return true;
      }

      return false;
    } catch {
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

  // Request logging (make it obvious if /graphql is even hit)
  app.use((req, _res, next) => {
    if (req.path === '/graphql' || req.path.startsWith('/auth') || req.path.startsWith('/api')) {
      console.log(`[REQ] ${req.method} ${req.path} origin=${req.headers.origin || 'n/a'}`);
    }
    next();
  });

  // Attach user/session
  app.use(attachUser);

  // ---- GraphQL ----
  const server = new ApolloServer<GraphQLContext>({ typeDefs, resolvers });
  await server.start();

  // Explicitly handle GET /graphql (helps debugging and some tooling)
  app.get('/graphql', (_req, res) => {
    res.status(200).send('GraphQL endpoint is alive. Use POST.');
  });

  // Hard "hit" log right at the route
  app.all('/graphql', (req, _res, next) => {
    console.log(`[HIT] /graphql ${req.method} content-type=${req.headers['content-type'] ?? 'n/a'}`);
    next();
  });

  app.use(
    '/graphql',
    expressMiddleware(server, {
      context: async ({ req, res }: ExpressContextFunctionArgument): Promise<GraphQLContext> => {
        const legacy = req.user;
        const sess = req.sessionUser;
        const user = legacy ?? (sess ? { id: sess.uid, email: sess.email } : null);
        return { req, res, user };
      },
    })
  );

  // ---- Rest routes ----
  app.use('/auth', googleRouter);
  app.use('/auth', emailRouter);
  app.use('/auth', deleteAccountRouter);
  app.use('/auth', mobileAuthRouter);
  app.use('/auth', authGarmin);
  app.use('/auth', authStrava);

  app.use('/api', garminBackfill);
  app.use('/api', stravaBackfill);
  app.use('/api', dataSourceRouter);
  app.use('/api', duplicatesRouter);
  app.use('/api', waitlistRouter);
  app.use('/api/admin', adminRouter);

  app.use(webhooksGarmin);
  app.use(webhooksStrava);

  app.use('/onboarding', onboardingRouter);
  app.use(garminTest);
  app.use(mockGarmin);

  // Error handler (so you see thrown middleware errors)
  app.use((err: Error, _req: Request, res: Response) => {
    console.error('[ERROR]', err?.message ?? err, err?.stack);
    res.status(500).json({ error: 'internal_error', message: err?.message ?? String(err) });
  });

  const PORT = Number(process.env.PORT) || 4000;
  const HOST = '0.0.0.0';

  // Start BullMQ workers if Redis is configured
  if (process.env.REDIS_URL) {
    // Initialize Redis connection and verify health at startup
    try {
      getRedisConnection();
      const health = await checkRedisHealth();
      if (health.healthy) {
        console.log(`[Redis] Startup health check passed (latency: ${health.latencyMs}ms)`);
      } else {
        console.warn('[Redis] Startup health check failed:', health.status, health.lastError ?? '');
      }
    } catch (err) {
      console.error(
        '[Redis] Initialization failed:',
        err instanceof Error ? err.message : 'Unknown error'
      );
    }

    startWorkers();
  } else {
    console.warn('[Workers] REDIS_URL not set, workers disabled');
  }

  app.listen(PORT, HOST, () => {
    console.log(`🚴 LoamLogger backend running on :${PORT} (GraphQL at /graphql)`);
  });

  process.on('SIGTERM', async () => {
    await stopWorkers();
    await server.stop();
    process.exit(0);
  });
};

startServer();
