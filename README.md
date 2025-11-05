# 🌲 Loam Logger

A **mountain bike–focused ride tracker** built with **React + Vite + GraphQL + Prisma**.  
Loam Logger lets riders log, analyze, and visualize their rides while tracking bike components and wear over time.

Built by **Ryan LeCours** to combine data-driven performance tracking with the MTB lifestyle.

---

## 🚀 Tech Stack

### Frontend
- **Framework:** [Vite + React + TypeScript](https://vitejs.dev/)
- **Styling:** [Tailwind CSS v4](https://tailwindcss.com/docs/v4-beta)
- **State / API:** Apollo Client (GraphQL)
- **Deployment:** [Vercel](https://vercel.com)
- **Theme:** Custom Loam palette (forest + loam tones) via CSS variables

### Backend
- **Runtime:** Node.js 20 + TypeScript
- **Framework:** Express + Apollo Server (GraphQL)
- **ORM:** Prisma ORM
- **Database:** PostgreSQL (hosted on [Railway](https://railway.app))
- **Auth:** JWT-based (Garmin OAuth integration in progress)
- **Hosting:** Railway

---

## 📁 Monorepo Structure

```
loam-logger/
│
├── frontend/       # React + Vite + Tailwind app
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   └── styles/theme.css
│   └── vite.config.ts
│
├── backend/        # Node.js GraphQL API with Prisma
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   └── src/
│       ├── index.ts
│       ├── resolvers/
│       ├── middleware/
│       └── types/
│
├── package.json    # npm workspaces config
└── README.md
```

---

## ⚙️ Setup

### 1. Clone & install
```bash
git clone https://github.com/yourusername/loam-logger.git
cd loam-logger
npm install
```

### 2. Environment variables

#### Backend (`backend/.env`)
```env
NODE_ENV=development
PORT=4000

DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DBNAME?sslmode=require"
JWT_SECRET="dev-super-secret"
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

### Backend
```bash
cd backend
npm run dev
```
Runs the GraphQL API at [http://localhost:4000/graphql](http://localhost:4000/graphql)

### Frontend
```bash
cd frontend
npm run dev
```
Starts Vite on [http://localhost:5173](http://localhost:5173)

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
- Gear wear tracking analytics
- Ride stats dashboard with 1w / 1m / 3m / YTD metrics
- Bike-based time distribution chart
- React Native mobile app (Phase 2)

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
