# Hospital Management System

Hospital software for Nepal. Covers OPD/IPD, appointments, lab, radiology, pharmacy, billing, insurance, payroll, and related hospital desks.

Stack: Node.js, Express, MongoDB, React, Vite.

## Folders

- `backend` — REST API
- `frontend` — web app

## Requirements

- Node.js 18 or later
- MongoDB 6 or later

## Backend

```bash
cd backend
npm install
copy .env.example .env
```

Open `.env` and set:

- `MONGODB_URI`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET` (must be different from the access secret)

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

```bash
npm run seed
npm run dev
```

API runs on http://localhost:5050

## Frontend

```bash
cd frontend
npm install
npm run dev
```

App runs on http://localhost:5180 and proxies `/api` to the backend.

Sign in with the seeded admin account from the seed script output (default `admin@hospital.local` / `Admin@12345`). Change that password after first login.

## Scripts

Backend:

| Command | What it does |
|---|---|
| `npm run dev` | API with file watch |
| `npm start` | API |
| `npm run seed` | Demo data (safe to re-run) |
| `npm run migrate` | Database migrations |
| `npm test` | Tests |
| `npm run lint` | Lint |

Frontend:

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run lint` | Lint |

## Docker

From `backend`:

```bash
docker build -t hms-api .
```

From `frontend`:

```bash
docker build -t hms-web .
```
