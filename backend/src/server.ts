import express from 'express';
import cors from 'cors';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express4';
import { typeDefs } from './graphql/schema.ts';
import { resolvers } from './graphql/resolvers.ts';
import dotenv from 'dotenv';

dotenv.config();

const startServer = async () => {
  const app = express();
  app.use(cors());

  const server = new ApolloServer({
    typeDefs,
    resolvers,
  });

  await server.start();

  app.use(
    '/graphql',
    express.json(),
    expressMiddleware(server) // Note: this is from @apollo/server/express4
  );

  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    console.log(`🚴 LoamLogger backend running at http://localhost:${PORT}/graphql`);
  });
};

startServer();