# 🌲 Loam Logger

A **mountain bike–focused ride tracker** built with **React + Vite + GraphQL + Prisma**.
Loam Logger lets riders log, analyze, and visualize their rides while tracking bike components and wear over time.

Built by [**Ryan LeCours**](https://www.ryanlecours.dev) to combine data-driven performance tracking with the MTB lifestyle.

---

## 🚀 Tech Stack

### Web App
- **Framework:** [Vite + React 19 + TypeScript](https://vitejs.dev/)
- **Styling:** [Tailwind CSS v4](https://tailwindcss.com/docs/v4-beta) + modular CSS architecture
- **State / API:** Apollo Client (GraphQL)
- **Animations:** Motion (Framer Motion)
- **Drag & Drop:** @dnd-kit
- **Testing:** Vitest + React Testing Library
- **Deployment:** [Vercel](https://vercel.com)
- **Theme:** Custom Loam palette (obsidian + forest + mahogany tones)

### Mobile App
- **Framework:** React Native + [Expo Router](https://expo.github.io/router/)
- **Navigation:** File-based routing with tab navigation
- **State / API:** Apollo Client (GraphQL with bearer token auth)
- **Auth:** Email/password, Google Sign-In, Apple Sign-In
- **Storage:** Expo SecureStore for encrypted token storage

### Backend API
- **Runtime:** Node.js 20 + TypeScript
- **Framework:** Express + Apollo Server (GraphQL)
- **ORM:** Prisma ORM
- **Database:** PostgreSQL (hosted on [Railway](https://railway.app))
- **Auth:** JWT tokens (cookie-based for web, bearer token for mobile)
- **Hosting:** Railway

### Monorepo
- **Build System:** [Nx](https://nx.dev/)
- **Package Manager:** npm workspaces
- **Shared Libraries:** `@loam/graphql` (GraphQL operations), `@loam/shared` (types & utils)

---

## 📁 Monorepo Structure

```
loam-logger/
├── apps/
│   ├── web/              # React + Vite web app
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── dashboard/    # Dashboard components
│   │   │   │   ├── gear/         # Bike & component management
│   │   │   │   └── ui/           # Shared UI components
│   │   │   ├── pages/
│   │   │   └── styles/
│   │   │       ├── index.css           # Main entry
│   │   │       ├── design-system/      # Colors, typography, utilities
│   │   │       ├── components/         # Button, card, form styles
│   │   │       ├── layout/             # Navigation, backgrounds
│   │   │       ├── pages/              # Page-specific styles
│   │   │       └── animations.css
│   │   └── vite.config.ts
│   │
│   ├── api/              # Express + GraphQL API
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── migrations/
│   │   └── src/
│   │       ├── server.ts
│   │       ├── graphql/
│   │       ├── routes/
│   │       └── auth/
│   │
│   └── mobile/           # React Native + Expo app
│       ├── app/
│       │   ├── (auth)/   # Auth screens
│       │   └── (tabs)/   # Main app tabs
│       └── src/
│           ├── lib/      # Apollo Client, auth utils
│           └── hooks/    # Auth context
│
├── libs/
│   ├── graphql/          # Shared GraphQL operations
│   │   ├── src/
│   │   │   ├── operations/
│   │   │   ├── fragments/
│   │   │   └── generated/
│   │   └── codegen.ts
│   │
│   └── shared/           # Shared types & utilities
│       └── src/
│           ├── types/
│           ├── utils/
│           └── constants/
│
├── nx.json               # Nx workspace config
├── tsconfig.base.json    # Shared TypeScript config
└── package.json          # npm workspaces config
```

---

## ⚙️ Setup

### 1. Clone & install
```bash
git clone https://github.com/ryanlecours/loam-logger.git
cd loam-logger
npm install
```

### 2. Environment variables

#### Backend (`apps/api/.env`)
```env
NODE_ENV=development
PORT=4000

DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DBNAME?sslmode=require"
CORS_ORIGIN="http://localhost:5173"
FRONTEND_URL="http://localhost:5173"

# Redis (required for job queues and rate limiting)
REDIS_URL="redis://localhost:6379"

# Garmin Connect API
GARMIN_CONSUMER_KEY="your-garmin-consumer-key"
GARMIN_CONSUMER_SECRET="your-garmin-consumer-secret"

# Strava API
STRAVA_CLIENT_ID="your-strava-client-id"
STRAVA_CLIENT_SECRET="your-strava-client-secret"
STRAVA_WEBHOOK_VERIFY_TOKEN="your-webhook-verify-token"

# WHOOP API
WHOOP_CLIENT_ID="your-whoop-client-id"
WHOOP_CLIENT_SECRET="your-whoop-client-secret"
```

#### Frontend (`apps/web/.env`)
```env
VITE_API_URL=http://localhost:4000/graphql
```

---

## 🧩 Database Setup

```bash
cd apps/api

# validate the schema + env
npx prisma validate --schema=./prisma/schema.prisma

# generate Prisma client
npx prisma generate --schema=./prisma/schema.prisma

# create / apply local migrations
npx prisma migrate dev --schema=./prisma/schema.prisma

# optional: open Prisma Studio
npx prisma studio
```

If using Railway, your `DATABASE_URL` will point to the hosted Postgres instance.

---

## 🖥️ Run Locally

All commands should be run from the **root directory** of the monorepo:

### Web App
```bash
npm run dev:web
```
Starts Vite on [http://localhost:5173](http://localhost:5173)

### API
```bash
npm run dev:api
```
Runs the GraphQL API at [http://localhost:4000/graphql](http://localhost:4000/graphql)

### Mobile App
```bash
npm run dev:mobile
```
Starts Expo development server. Scan QR code with Expo Go app on your device.

### Build All
```bash
npm run build
```
Builds all apps using Nx affected commands.

### Run Tests
```bash
npm run test:web
```
Runs all 400+ unit tests with Vitest.

---

## 🧠 Features

### ✅ Current
- **Gear Management** — Full bike and component management system
- **Component Health Tracking** — Service predictions with status indicators (overdue, due soon, all good)
- **Dashboard** — Priority bike hero, recent rides, component health panels
- **Service Logging** — Log component services with date tracking and wear baselines
- **Bike Detail Pages** — Individual bike profiles with specs, components, and service history
- **E-bike Support** — Motor power, torque, and battery specifications
- **99 Spokes Integration** — Import bike specifications from 99spokes.com
- **Spare Components** — Track components not currently installed on bikes
- **Light/Dark Theming** — Premium dark theme with obsidian + forest tones
- **Modular CSS Architecture** — Refactored styling system with design tokens
- **Drag & Drop Bike Sorting** — Reorder bikes on dashboard
- **Comprehensive Test Coverage** — 700+ unit tests across components

### 🔗 Data Source Integrations

Loam Logger connects to popular fitness platforms to automatically import your rides:

| Platform | Features |
|----------|----------|
| **Garmin Connect** | OAuth integration, webhook-based real-time sync, historical backfill with import sessions |
| **Strava** | OAuth integration, webhook-based real-time sync, gear mapping to bikes, historical backfill |
| **WHOOP** | OAuth integration, webhook-based real-time sync, Cycling + Mountain Biking support, API v2 with UUID workout IDs |

**Key capabilities:**
- **Real-time sync** — Webhooks push new activities as they're recorded
- **Historical backfill** — Import past rides by year or YTD with incremental checkpointing
- **Cross-provider duplicate detection** — Avoid importing the same ride from multiple sources
- **Automatic bike assignment** — Strava gear IDs map to your bikes; single-bike users get auto-assignment
- **Component hour tracking** — Ride duration automatically updates component wear metrics

### 🔜 Coming Soon
- Analytics dashboard with ride insights
- Mobile app features (ride sync, gear tracking, offline support)

---

## 📊 Analytics Stack (Planned)

```
Frontend (React)
  └── PostHog (events, funnels, feature flags)

Backend (Node / GraphQL)
  ├── PostgreSQL (source of truth)
  ├── Aggregated metrics tables
  └── Sentry (errors + performance)

Infrastructure
  ├── Vercel Analytics (traffic)
  └── PostHog (product insights)
```

---

## 🧱 Theming

The **Loam Logger design system** uses earthy tones inspired by trail environments.

**Color System:**
- **Obsidian base** — Deep near-blacks (rgb(12, 12, 14))
- **Forest/Sage accents** — Muted greens for primary actions
- **Mahogany warmth** — Reddish-brown accent colors
- **Warm-tinted neutrals** — Subtle warmth in grays

Defined in [`styles/design-system/colors.css`](apps/web/src/styles/design-system/colors.css).

---

## 🔒 Environment & Deployment

### Railway → Backend
- Deploy backend using the Railway CLI or GitHub integration.
- Set your production `DATABASE_URL`, `JWT_SECRET`, and `CORS_ORIGIN` variables.

### Vercel → Frontend
- Set `VITE_API_URL` to your Railway backend endpoint.
- Enable automatic redeploys from `main`.

---

## 🧑‍💻 Development Workflow

### GraphQL Code Generation

When you update the GraphQL schema:

```bash
# 1. Start the API (required for introspection)
npm run dev:api

# 2. Generate TypeScript types
npm run codegen

# 3. Commit the generated files
git add libs/graphql/src/generated/
git commit -m "Update GraphQL types"
```

**Important:** Generated files are committed to the repository. See [libs/graphql/README.md](libs/graphql/README.md) for details.

### Nx Commands

```bash
# Lint all affected projects
npx nx affected -t lint

# Build all affected projects
npx nx affected -t build

# Run specific app
npx nx serve web      # Web app
npx nx serve api      # API
npx nx start mobile   # Mobile app

# Run tests
npx nx test web       # Web tests

# View project graph
npx nx graph
```

### CI/CD

GitHub Actions runs automatically on push and PR. See [CI_CD_GUIDE.md](CI_CD_GUIDE.md) for troubleshooting.

**Key points:**
- Only affected projects are tested/built
- GraphQL types must be generated locally and committed
- Production APIs have introspection disabled for security

### Development Notes

- Nx workspace with affected commands for faster builds
- Shared libraries (`@loam/graphql`, `@loam/shared`) for code reuse
- React 19.1 enforced via npm overrides across all projects
- Prisma commands run from `apps/api` directory

---

## 📜 License
MIT © 2025 Ryan LeCours

---

### 🏔️ "Log your loam. Track your rides. Know your trails."