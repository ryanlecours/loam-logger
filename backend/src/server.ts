// server.ts
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
import { attachUser } from './middleware/attachUser.ts';
import mockGarmin from './routes/mock.garmin.ts';

export type GraphQLContext = {
  req: Request;
  res: Response;
  user: { id: string; email?: string } | null;
};

const startServer = async () => {
  const app = express();

  app.use(
    cors({
      origin: process.env.APP_ORIGIN || 'http://localhost:5173',
      credentials: true,
    })
  );

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser(process.env.COOKIE_SECRET || 'dev-secret'));

  // Attach a (mock) user so /auth/garmin/callback can store tokens
  app.use(attachUser);

  // REST routes
  app.use(authGarmin);
  app.use(garminTest);
  app.use(mockGarmin);

  // Apollo
  const server = new ApolloServer<GraphQLContext>({ typeDefs, resolvers });
  await server.start();
  app.use(
    '/graphql',
    expressMiddleware(server, {
      context: async ({ req, res }: ExpressContextFunctionArgument): Promise<GraphQLContext> => ({
        req,
        res,
        user: (req as any).user ?? null,
      }),
    })
  );

  // ✅ Railway health check (set Railway to /health OR keep this path)
  app.get('/health', (_req, res) => res.status(200).send('ok'));

  const PORT = Number(process.env.PORT) || 4000;
  const HOST = '0.0.0.0'; // ✅ bind to all interfaces for Railway

  app.listen(PORT, HOST, () => {
    console.log(`🚴 LoamLogger backend running on :${PORT} (GraphQL at /graphql)`);
  });

  // (Optional) graceful shutdown
  process.on('SIGTERM', async () => {
    await server.stop();
    process.exit(0);
  });
};

startServer();
