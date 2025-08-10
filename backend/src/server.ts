import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { ApolloServer } from '@apollo/server'
import { expressMiddleware } from '@as-integrations/express4'
import { typeDefs } from './graphql/schema.ts'
import { resolvers } from './graphql/resolvers.ts'
import authGarmin from './routes/auth.garmin.ts'          // /auth/garmin/start + /auth/garmin/callback
import garminTest from './routes/garmin.test.ts'          // GET /me/garmin/activities (optional)
import { attachUser } from './middleware/attachUser.ts'   // sets req.user (mock for now)
import dotenv from 'dotenv'
import mockGarmin from './routes/mock.garmin.ts'

dotenv.config()

const startServer = async () => {
  const app = express()

  // CORS (adjust as needed if you send cookies across origins)
  app.use(cors({
    origin: process.env.APP_ORIGIN || 'http://localhost:5173',
    credentials: true,
  }))

  // Make JSON bodies available to ALL routes (not just /graphql)
  app.use(express.json())
  app.use(express.urlencoded({ extended: false }))

  // Needed for cookie-based PKCE/state (ll_oauth_state, ll_pkce_verifier)
  app.use(cookieParser(process.env.COOKIE_SECRET || 'dev-secret'))

  // Attach a mock user so /auth/garmin/callback can store tokens
  app.use(attachUser)

  // Your REST routes (OAuth + test)
  app.use(authGarmin)
  app.use(garminTest)
  app.use(mockGarmin)

  // Apollo
  const server = new ApolloServer({ typeDefs, resolvers })
  await server.start()

  // You can drop this express.json() now since we added a global one above
  app.use('/graphql', expressMiddleware(server, {
    context: async ({ req, res }) => ({
      user: (req as any).user,   // typed if you added the global.d.ts augmentation
      res,
    }),
  }))

  app.get('/healthz', (_req, res) => res.send('ok'))

  const PORT = process.env.PORT || 4000
  app.listen(PORT, () => {
    console.log(`🚴 LoamLogger backend running at http://localhost:${PORT}/graphql`)
  })
}

startServer()
