# 🌲 Loam Logger

A **mountain bike–focused ride tracker** built with **React + Vite + GraphQL + Prisma**.  
Loam Logger lets riders log, analyze, and visualize their rides while tracking bike components and wear over time.

Built by [**Ryan LeCours**](https://www.ryanlecours.dev) to combine data-driven performance tracking with the MTB lifestyle.

---

## 🚀 Tech Stack

### Web App
- **Framework:** [Vite + React + TypeScript](https://vitejs.dev/)
- **Styling:** [Tailwind CSS v4](https://tailwindcss.com/docs/v4-beta)
- **State / API:** Apollo Client (GraphQL)
- **Deployment:** [Vercel](https://vercel.com)
- **Theme:** Custom Loam palette (forest + loam tones) via CSS variables

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
│   │   │   ├── pages/
│   │   │   └── styles/theme.css
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

#### Backend (`backend/.env`)
```env
NODE_ENV=development
PORT=4000

DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DBNAME?sslmode=require"
JWT_SECRET="dev-super-secret" # Temp JWT Token placeholder until Garmin API Access is granted.
CORS_ORIGIN="http://localhost:5173"
```

#### Frontend (`frontend/.env`)
```env
VITE_API_URL=http://localhost:4000/graphql
```

---

## 🧩 Database Setup

```bash
cd backend

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

---

## 🧠 Features (Planned / In Progress)

### ✅ Current
- GraphQL API with Prisma + PostgreSQL
- User authentication (JWT)
- Ride data models (distance, elevation, time)
- Component tracking schema (wheels, tires, drivetrain, etc.)
- Light/dark theming (Tailwind + CSS variables)

### 🔜 Coming Soon
- Garmin OAuth integration
- Strava OAuth integration
- Gear wear tracking analytics
- Ride stats dashboard with 1w / 1m / 3m / YTD metrics
- Bike-based time distribution chart
- Mobile app features (ride sync, gear tracking, offline support)

---

## 🧱 Theming

The **Loam Logger design system** uses earthy tones inspired by trail environments.  
- **Light mode:** layered off-whites with forest-green accents  
- **Dark mode:** deep near-blacks with loam/dirt accent colors  

Defined in [`theme.css`](frontend/src/styles/theme.css).

---

## 🔒 Environment & Deployment

### Railway → Backend
- Deploy backend using the Railway CLI or GitHub integration.
- Set your production `DATABASE_URL`, `JWT_SECRET`, and `CORS_ORIGIN` variables.

### Vercel → Frontend
- Set `VITE_API_URL` to your Railway backend endpoint.
- Enable automatic redeploys from `main`.

---

## 🧑‍💻 Development Notes

- Backend uses **ESM** modules with `tsx` runner for hot reload.  
- Prisma schema and migrations must run **from the backend directory**.  
- Consistent import aliasing via `tsconfig.paths.json`.

---

## 📜 License
MIT © 2025 Ryan LeCours

---

### 🏔️ "Log your loam. Track your rides. Know your trails."
