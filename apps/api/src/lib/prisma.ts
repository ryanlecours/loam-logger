import { PrismaClient } from '@prisma/client';
import * as Sentry from '@sentry/node';

declare global { var __prisma__: PrismaClient | undefined; }

function createPrismaClient(): PrismaClient {
  const base = new PrismaClient();

  // Emit a Sentry breadcrumb per Prisma operation so error events can show
  // the last few DB calls as context. Never includes `args` — parameters may
  // contain PII and we don't want to ship them to Sentry.
  //
  // Uses the $extends query hook rather than the deprecated $use middleware.
  // Note: $extends returns a new client; callers get the extended one.
  return base.$extends({
    query: {
      $allOperations({ model, operation, query, args }) {
        const start = Date.now();
        const result = query(args);
        // Fire-and-forget: don't wait on the query to resolve before returning.
        Promise.resolve(result)
          .then(() => {
            Sentry.addBreadcrumb({
              category: 'prisma',
              type: 'query',
              level: 'info',
              message: `${model ?? 'raw'}.${operation}`,
              data: { durationMs: Date.now() - start },
            });
          })
          .catch(() => {
            Sentry.addBreadcrumb({
              category: 'prisma',
              type: 'query',
              level: 'warning',
              message: `${model ?? 'raw'}.${operation} (failed)`,
              data: { durationMs: Date.now() - start },
            });
          });
        return result;
      },
    },
  }) as unknown as PrismaClient;
}

export const prisma = global.__prisma__ ?? createPrismaClient();
if (process.env.NODE_ENV !== 'production') global.__prisma__ = prisma;
