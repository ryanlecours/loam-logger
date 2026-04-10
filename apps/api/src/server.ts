import 'dotenv/config';
import './instrument';
import * as Sentry from '@sentry/node';
import crypto from 'crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware, type ExpressContextFunctionArgument } from '@as-integrations/express4';
import { typeDefs } from './graphql/schema';
import { resolvers } from './graphql/resolvers';
import { startWorkers, stopWorkers } from './workers';
import { getRedisConnection, checkRedisHealth } from './lib/redis';
import { startEmailScheduler, stopEmailScheduler } from './services/email-scheduler.service';
import { startImportSessionChecker, stopImportSessionChecker } from './services/import-session-checker.service';
import { startOAuthCleanup, stopOAuthCleanup } from './services/oauth-cleanup.service';
import { rootLogger, logger } from './lib/logger';
import { validateEncryptionKey } from './lib/crypto';
import {
  runWithRequestContext,
  createRequestContext,
  enrichRequestContext,
} from './lib/requestContext';

import authGarmin from './routes/auth.garmin';
import authStrava from './routes/auth.strava';
import authWhoop from './routes/auth.whoop';
import { createDataLoaders, type DataLoaders } from './graphql/dataloaders';
import webhooksGarmin from './routes/webhooks.garmin';
import webhooksStrava from './routes/webhooks.strava';
import webhooksWhoop from './routes/webhooks.whoop';
import garminBackfill from './routes/garmin.backfill';
import stravaBackfill from './routes/strava.backfill';
import whoopBackfill from './routes/whoop.backfill';
import backfillHistory from './routes/backfill.history';
import dataSourceRouter from './routes/data-source';
import duplicatesRouter from './routes/duplicates';
import garminTest from './routes/garmin.test';
import mockGarmin from './routes/mock.garmin';
import onboardingRouter from './routes/onboarding';
import waitlistRouter from './routes/waitlist';
import adminRouter from './routes/admin';
import spokesRouter from './routes/spokes';
import emailUnsubscribeRouter from './routes/email.unsubscribe';
import { googleRouter, emailRouter, deleteAccountRouter, passwordRouter, attachUser, verifyCsrf } from './auth/index';
import webhooksStripe from './routes/webhooks.stripe';
import webhooksRevenueCat from './routes/webhooks.revenuecat';
import { validateStripeConfig } from './lib/stripe';
import { FRONTEND_URL } from './config/env';
import referralRouter from './routes/referral';
import mobileAuthRouter from './auth/mobile.route';

export type GraphQLContext = {
  req: Request;
  res: Response;
  user: { id: string; email?: string } | null;
  loaders: DataLoaders;
};

const startServer = async () => {
  // Validate required environment variables at startup
  if (!process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET environment variable is required');
  }
  validateEncryptionKey();

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
    allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token'],
  });

  app.use(corsMw);
  app.options('*', corsMw);

  // Stripe webhook must be registered before express.json() to access raw body for signature verification
  if (process.env.STRIPE_SECRET_KEY) {
    validateStripeConfig(); // Fail fast if any Stripe env vars are missing
    app.use('/webhooks/stripe', express.raw({ type: 'application/json' }), webhooksStripe);
  }

  // RevenueCat webhook registered before global express.json() — needs its own
  // JSON parser since the global middleware hasn't been applied yet at this point.
  if (process.env.REVENUECAT_WEBHOOK_AUTH_KEY) {
    app.use('/webhooks/revenuecat', express.json(), webhooksRevenueCat);
  }

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser(process.env.COOKIE_SECRET || 'dev-secret'));

  // pino-http middleware configuration
  const httpLogger = pinoHttp({
    logger: rootLogger,
    genReqId: (req, res) => {
      const existingId = req.headers['x-request-id'] as string | undefined;
      const requestId = existingId ?? crypto.randomUUID();
      res.setHeader('x-request-id', requestId);
      return requestId;
    },
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
    customErrorMessage: (req, _res, err) => `${req.method} ${req.url} errored: ${err.message}`,
    autoLogging: {
      ignore: (req) => req.url === '/health', // Skip health check spam
    },
  });

  // AsyncLocalStorage context wrapper (must wrap entire request)
  app.use((req, res, next) => {
    const existingId = req.headers['x-request-id'] as string | undefined;
    const context = createRequestContext(req.method, req.path, existingId);

    runWithRequestContext(context, () => {
      req.requestId = context.requestId;
      res.setHeader('x-request-id', context.requestId);
      next();
    });
  });

  // HTTP request/response logging
  app.use(httpLogger);

  // Attach user/session
  app.use(attachUser);

  // Enrich context with userId after auth
  app.use((req, _res, next) => {
    const userId = req.sessionUser?.uid ?? req.user?.id;
    if (userId) {
      enrichRequestContext({ userId });
      Sentry.setUser({ id: userId });
    }
    next();
  });

  // CSRF protection for state-changing requests
  // Skips: GET/HEAD/OPTIONS, Bearer token auth (mobile), unauthenticated requests
  app.use(verifyCsrf);

  // ---- GraphQL ----
  const server = new ApolloServer<GraphQLContext>({ typeDefs, resolvers });
  await server.start();

  // Explicitly handle GET /graphql (helps debugging and some tooling)
  app.get('/graphql', (_req, res) => {
    res.status(200).send('GraphQL endpoint is alive. Use POST.');
  });

  app.use(
    '/graphql',
    expressMiddleware(server, {
      context: async ({ req, res }: ExpressContextFunctionArgument): Promise<GraphQLContext> => {
        const legacy = req.user;
        const sess = req.sessionUser;
        const user = legacy ?? (sess ? { id: sess.uid, email: sess.email } : null);

        // Extract and log GraphQL operation
        const body = req.body as { operationName?: string } | undefined;
        const operationName = body?.operationName ?? 'anonymous';
        enrichRequestContext({ operationName });

        logger.info({ operationName, hasUser: !!user }, 'GraphQL operation');

        return { req, res, user, loaders: createDataLoaders() };
      },
    })
  );

  // ---- Rest routes ----
  app.use('/auth', googleRouter);
  app.use('/auth', emailRouter);
  app.use('/auth', deleteAccountRouter);
  app.use('/auth', passwordRouter);
  app.use('/auth', mobileAuthRouter);
  app.use('/auth', authGarmin);
  app.use('/auth', authStrava);
  app.use('/auth', authWhoop);

  app.use('/api', garminBackfill);
  app.use('/api', stravaBackfill);
  app.use('/api', whoopBackfill);
  app.use('/api', backfillHistory);
  app.use('/api', dataSourceRouter);
  app.use('/api', duplicatesRouter);
  app.use('/api', waitlistRouter);
  app.use('/api', emailUnsubscribeRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/spokes', spokesRouter);

  app.use(webhooksGarmin);
  app.use(webhooksStrava);
  app.use('/webhooks', webhooksWhoop);

  app.use('/onboarding', onboardingRouter);
  app.use(referralRouter);
  app.use(garminTest);
  app.use(mockGarmin);

  // Sentry error handler must come before custom error handler
  Sentry.setupExpressErrorHandler(app);

  // Error handler (so you see thrown middleware errors)
  // Note: Express requires all 4 params for error middleware to be recognized
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
    res.status(500).json({
      error: 'internal_error',
      message: err?.message || 'Unknown error',
      requestId: req.requestId,
    });
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
        logger.info({ latencyMs: health.latencyMs }, 'Redis startup health check passed');
      } else {
        logger.warn({ status: health.status, error: health.lastError }, 'Redis startup health check failed');
      }
    } catch (err) {
      logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Redis initialization failed');
    }

    startWorkers();
  } else {
    logger.warn('REDIS_URL not set, workers disabled');
  }

  // Start email scheduler (checks for due scheduled emails every minute)
  startEmailScheduler();

  // Start import session checker (checks for idle import sessions every minute)
  startImportSessionChecker();

  // Start OAuth attempt cleanup (deletes expired records hourly)
  startOAuthCleanup();

  app.listen(PORT, HOST, () => {
    logger.info({ port: PORT }, 'LoamLogger backend running (GraphQL at /graphql)');
  });

  process.on('SIGTERM', async () => {
    await stopEmailScheduler();
    await stopImportSessionChecker();
    stopOAuthCleanup();
    await stopWorkers();
    await Sentry.flush(2000);
    await server.stop();
    process.exit(0);
  });
};

startServer();
