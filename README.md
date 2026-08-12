# Hospital Management System (HMS)

A MERN hospital management system for a single hospital with multiple departments and wards.

**Current state:** Phase 0 (foundation), Phase 1 (patients, EMR, departments, wards/beds) and Phase 4 (laboratory) are complete and working. See [PLAN.md](./PLAN.md) for the full roadmap and [ARCHITECTURE.md](./ARCHITECTURE.md) for schema, relationships, auth strategy, and conventions.

---

## Stack

| Layer | Choice |
|---|---|
| Database | MongoDB + Mongoose 8 |
| API | Node.js + Express 4 (ESM) |
| Validation | zod |
| Auth | JWT (access + refresh) in httpOnly cookies, bcrypt password hashing |
| Client | React 18 + Vite 5 + React Router 6 + Tailwind CSS 3 |

---

## Prerequisites

- **Node.js 18+** (developed on 24)
- **MongoDB 6+** running locally, or a MongoDB Atlas connection string

Check MongoDB is reachable:

```bash
mongosh --eval "db.runCommand({ ping: 1 })"
```

---

## Setup

### 1. Server

```bash
cd server
npm install
cp .env.example .env
```

Now open `server/.env` and set the two JWT secrets. Generate them with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Run it twice — `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` **must be different**, or the server refuses to start.

#### Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | no | `development` | `production` hides stack traces and forces secure cookies |
| `PORT` | no | `5000` | API port |
| `MONGODB_URI` | **yes** | — | e.g. `mongodb://127.0.0.1:27017/hms` |
| `JWT_ACCESS_SECRET` | **yes** | — | 32+ chars in production |
| `JWT_REFRESH_SECRET` | **yes** | — | Must differ from the access secret |
| `JWT_ACCESS_EXPIRES_IN` | no | `15m` | Access token lifetime |
| `JWT_REFRESH_EXPIRES_IN` | no | `7d` | Refresh token lifetime |
| `COOKIE_SECURE` | no | `false` | Set `true` when serving over HTTPS |
| `COOKIE_DOMAIN` | no | — | Only needed for cross-subdomain deployments |
| `CLIENT_ORIGIN` | no | `http://localhost:5173` | Comma-separated allowed CORS origins |
| `UPLOADS_DIR` | no | `uploads` | Where generated PDFs are written (relative to `server/`) |
| `HOSPITAL_NAME` | no | `General Hospital` | Printed on lab report letterheads |
| `HOSPITAL_ADDRESS` | no | `1 Hospital Road, City` | Printed on lab report letterheads |
| `HOSPITAL_PHONE` | no | — | Printed on lab report letterheads |
| `HOSPITAL_EMAIL` | no | — | Printed on lab report letterheads |
| `SEED_ADMIN_EMAIL` | no | `admin@hospital.local` | Used by `npm run seed` |
| `SEED_ADMIN_PASSWORD` | no | `Admin@12345` | Used by `npm run seed` |

#### Seed the database

```bash
npm run seed
```

Idempotent — safe to re-run. Creates:
- one **admin** account (credentials printed at the end),
- six departments (General Medicine, Surgery, Paediatrics, Obs & Gynae, Emergency, Critical Care),
- six wards with 56 beds total,
- a lab catalogue of 7 tests / 25 analytes with reference and critical ranges (FBC, BMP, LFT, Urinalysis, Malaria screen, TFT, Cardiac enzymes).

#### Start the API

```bash
npm run dev     # node --watch, restarts on file change
# or
npm start
```

API on `http://localhost:5000`. Health check: `http://localhost:5000/api/v1/health`

### 2. Client

```bash
cd client
npm install
npm run dev
```

App on `http://localhost:5173`. No client `.env` is needed — Vite proxies `/api` to `localhost:5000`, so the browser sees a single origin and the `SameSite=Strict` auth cookies work without any cross-site configuration.

---

## First run

1. Start MongoDB.
2. `cd server && npm run seed && npm run dev`
3. `cd client && npm install && npm run dev` (in a second terminal)
4. Open `http://localhost:5173`
5. Sign in with the seeded admin credentials (default `admin@hospital.local` / `Admin@12345`).

**Change the admin password immediately.** The seeded account is flagged `mustChangePassword`, and the app shows a banner until it's changed.

---

## Testing it locally

### Through the UI

| What | Where |
|---|---|
| Dashboard stats (patients, open visits, departments, bed availability) | `/` after login |
| Register a patient | Patients → **+ Register patient** — MRN is auto-assigned |
| **Duplicate detection** | Register a patient, then start registering the *same* person again — matches appear live as you type, with scores and the fields that matched |
| **Duplicate override** | On a blocked registration, tick "this is a different person" and give a reason (≥10 chars); the reason lands in the audit log |
| Search patients | Patients → search box (name, MRN, phone, email) |
| Patient record with tabs | Click any patient → Demographics · Medical history · Visits · Laboratory (tabs are permission-filtered) |
| Add allergies / conditions / medications | Patient → Medical history tab → **+ Add** on any section |
| Departments CRUD | Departments (admin only for writes) |
| Wards + occupancy bars | Wards & Beds |
| Bed roster, add beds, change bed status | Wards & Beds → click a ward |
| **Permission gating** | Sign in as a non-admin: the sidebar, buttons and tabs are filtered by the grants the server sent, and direct URLs redirect to `/forbidden` |
| **Nurse bed split** | As a nurse, changing a bed's *status* works; changing its *rate* is refused — same route, narrower grant |
| **Order lab tests** | Patient → **Laboratory** tab → **+ New lab order** (needs an open visit) |
| **Lab worklist** | Laboratory (sidebar) — pending queue for lab techs |
| **Sample tracking** | Lab order → *Mark sample collected* → *Start processing* |
| **Enter results** | Lab order → per-test form; flags preview live against reference ranges |
| **PDF report** | Auto-generated when the last test is verified → **📄 View report** |
| **Result timeline** | Patient → Laboratory tab → every result, newest first |
| **Test catalogue** | Laboratory → **Test catalogue** (admin) — tests, analytes, ranges, prices |

### Through the API

```bash
# health
curl http://localhost:5000/api/v1/health

# sign in (stores the httpOnly cookies in cookies.txt)
curl -c cookies.txt -X POST http://localhost:5000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@hospital.local","password":"Admin@12345"}'

# current session — includes the caller's full permission grant map
curl -b cookies.txt http://localhost:5000/api/v1/auth/me

# list patients
curl -b cookies.txt "http://localhost:5000/api/v1/patients?limit=10&search=okafor"

# register a patient
curl -b cookies.txt -X POST http://localhost:5000/api/v1/patients \
  -H 'Content-Type: application/json' \
  -d '{"firstName":"Ada","lastName":"Nwosu","dateOfBirth":"1992-03-15","gender":"female","phone":"+234 801 234 5678"}'

# create a staff account (admin only)
curl -b cookies.txt -X POST http://localhost:5000/api/v1/users \
  -H 'Content-Type: application/json' \
  -d '{"email":"nurse@hospital.local","password":"Nurse@1234","firstName":"Ama","lastName":"Yeboah","role":"nurse"}'
```

#### Walking the MPI duplicate check

```bash
# 1. Register someone
curl -b cookies.txt -X POST http://localhost:5000/api/v1/patients \
  -H 'Content-Type: application/json' \
  -d '{"firstName":"Amara","lastName":"Okafor","dateOfBirth":"1990-04-12","gender":"female","phone":"+234 802 555 0111","nationalId":"NG-88123456"}'

# 2. Try the same person again -> 409 POSSIBLE_DUPLICATE_PATIENT, score 100
curl -b cookies.txt -X POST http://localhost:5000/api/v1/patients \
  -H 'Content-Type: application/json' \
  -d '{"firstName":"Amara","lastName":"Okafor","dateOfBirth":"1990-04-12","gender":"female","phone":"+234 802 555 0111","nationalId":"NG-88123456"}'

# 3. Typo'd name, same DOB + phone, no national ID -> still blocked (score 82)
#    Note the phone is written differently; matching is on the last 9 digits.
curl -b cookies.txt -X POST http://localhost:5000/api/v1/patients \
  -H 'Content-Type: application/json' \
  -d '{"firstName":"Amarah","lastName":"Okafo","dateOfBirth":"1990-04-12","gender":"female","phone":"08025550111"}'

# 4. Override -> requires patients.overrideDuplicate AND a reason of 10+ chars
curl -b cookies.txt -X POST http://localhost:5000/api/v1/patients \
  -H 'Content-Type: application/json' \
  -d '{"firstName":"Amarah","lastName":"Okafo","dateOfBirth":"1990-04-12","gender":"female","phone":"08025550111","acknowledgeDuplicates":true,"duplicateOverrideReason":"Twin sister, shares household phone and date of birth."}'

# 5. Search without creating anything (what the form calls as you type)
curl -b cookies.txt -X POST http://localhost:5000/api/v1/patients/check-duplicates \
  -H 'Content-Type: application/json' \
  -d '{"lastName":"Okafor","dateOfBirth":"1990-04-12"}'
```

#### Reading the audit trail

```bash
# Everything, newest first (admin only)
curl -b cookies.txt "http://localhost:5000/api/v1/audit-logs?limit=20"

# Filter: what did this user do? what happened to this patient's chart?
curl -b cookies.txt "http://localhost:5000/api/v1/audit-logs?action=update&resourceType=Patient"
curl -b cookies.txt "http://localhost:5000/api/v1/audit-logs/patient/<patientId>"

# Failed sign-ins (attempted address + reason + IP are recorded)
curl -b cookies.txt "http://localhost:5000/api/v1/audit-logs?action=login_failed"
```

An update entry carries a real field-level diff:

```jsonc
{ "action": "update", "resourceRef": "MRN-000007", "userName": "System Administrator",
  "changes": { "phone":      { "from": "+234 802 555 0111", "to": "+234 802 555 0222" },
               "bloodGroup": { "from": "unknown",           "to": "O+" } } }
```

Passwords and tokens are redacted at any depth — a password change is recorded
as having happened, never as a value.

#### Walking the lab flow from the API

```bash
# 0. Sign in as a doctor and a lab tech (create them as admin first, see above)
curl -c doc.txt -X POST http://localhost:5000/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"dr.adeyemi@hospital.local","password":"Doctor@123"}'
curl -c tech.txt -X POST http://localhost:5000/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"labtech@hospital.local","password":"LabTech@1"}'

# 1. Doctor orders tests against an OPEN encounter (ids from /patients, /encounters, /lab/tests)
curl -b doc.txt -X POST http://localhost:5000/api/v1/lab/orders -H 'Content-Type: application/json' \
  -d '{"patientId":"<pid>","encounterId":"<eid>","labTestIds":["<fbcId>"],"priority":"urgent"}'

# 2. Charges appear immediately in the SHARED ledger — no lab-specific invoice
curl -b cookies.txt "http://localhost:5000/api/v1/billing/line-items?encounterId=<eid>"

# 3. Lab tech collects the specimen
curl -b tech.txt -X POST http://localhost:5000/api/v1/lab/orders/<oid>/collect \
  -H 'Content-Type: application/json' -d '{"sampleId":"SPEC-9931"}'

# 4. Enter results — flags are computed server-side from the catalogue ranges
curl -b tech.txt -X POST http://localhost:5000/api/v1/lab/orders/<oid>/results \
  -H 'Content-Type: application/json' \
  -d '{"labTestId":"<fbcId>","entries":[{"analyteCode":"HGB","value":"9.8"}],"status":"verified"}'

# 5. When every test is verified the order completes and the PDF is generated
curl -b tech.txt http://localhost:5000/api/v1/lab/orders/<oid>/report -o report.pdf
```

Things worth confirming:

- **Reference-range flagging** — enter `HGB 9.8` (range 13–17) → `low`; `K 2.3` (critical below 2.5) → `critical-low`; a urinalysis `Protein: 1+` against normal `negative` → `abnormal`.
- **Charges hit the shared ledger** — `GET /billing/line-items?encounterId=...` shows one `unbilled` row per test with `sourceType: "lab"`, and cancelling the order flips them to `cancelled`.
- **Sample tracking is a state machine** — calling `/collect` twice, or `/start` before `/collect`, returns `409 INVALID_STATUS_TRANSITION`.
- **Results are blocked before collection** — `409 SAMPLE_NOT_COLLECTED`.
- **Verified results are immutable** — re-submitting returns `409 RESULT_ALREADY_VERIFIED`; use `/results/:resultId/amend` with a reason, which regenerates the PDF.
- **Reports are auth-gated** — `curl` the report URL without cookies → `401`. `GET /uploads/...` → `404`; the directory is never statically served.
- **Snapshotting** — change a test's price in the catalogue; existing orders keep the price they were billed at.

- **Auth is enforced** — drop `-b cookies.txt` from any call above and you get `401 NO_TOKEN`.
- **RBAC is enforced** — sign in as the nurse and `POST /departments` returns `403 INSUFFICIENT_ROLE`.
- **Validation is enforced** — post a patient with `"dateOfBirth":"2099-01-01"` and you get `422` with a per-field `details` array.
- **Mass assignment is blocked** — send `"isActive":false` or `"mrn":"MRN-HACKED"` on patient creation; both are stripped.
- **Soft deletes** — `DELETE /patients/:id` sets `isActive:false`; the document is still in MongoDB.
- **Referential guards** — a patient with an open visit can't be deactivated; a department with active wards can't be deactivated; an occupied bed can't be removed.

---

## API surface

Base path `/api/v1`. All routes except login/refresh/logout require
authentication, and **every route declares a permission, not a role list**.

The "Permission" column is the `(module, action)` pair the route is gated on.
Look it up in `server/src/config/permissions.js` to see which roles hold it.

| Method | Path | Permission |
|---|---|---|
| `POST` | `/auth/login` | public |
| `POST` | `/auth/refresh` | public (refresh cookie) |
| `POST` | `/auth/logout` | public |
| `GET` | `/auth/me` | authenticated — returns the caller's full grant map |
| `POST` | `/auth/change-password` | authenticated |
| `GET/POST` | `/users` | `staff.view` / `staff.create` |
| `GET/PATCH/DELETE` | `/users/:id` | `staff.view` / `staff.edit` / `staff.delete` |
| `PATCH` | `/users/:id/restore` | `staff.restore` |
| `POST` | `/users/:id/reset-password` | `staff.resetPassword` |
| `GET` | `/audit-logs` | `auditLogs.view` |
| `GET` | `/audit-logs/patient/:patientId` | `auditLogs.view` |
| `GET` | `/patients` | `patients.view` |
| `POST` | `/patients/check-duplicates` | `patients.checkDuplicates` |
| `POST` | `/patients` | `patients.create` (+ `patients.overrideDuplicate` to force) |
| `GET/PATCH` | `/patients/:id` | `patients.view` / `patients.edit` |
| `PATCH` | `/patients/:id/medical-history` | `patients.editMedicalHistory` |
| `GET` | `/patients/:id/encounters` | `patients.view` |
| `DELETE` | `/patients/:id` | `patients.delete` |
| `PATCH` | `/patients/:id/restore` | `patients.restore` |
| `GET` | `/departments`, `/departments/:id` | `departments.view` |
| `POST/PATCH/DELETE` | `/departments`, `/departments/:id` | `departments.create` / `.edit` / `.delete` |
| `GET` | `/wards`, `/wards/:id` | `wards.view` |
| `POST/PATCH/DELETE` | `/wards`, `/wards/:id` | `wards.create` / `.edit` / `.delete` |
| `GET` | `/wards/:wardId/beds` | `beds.view` |
| `POST` | `/wards/:wardId/beds`, `…/bulk` | `beds.create` |
| `PATCH` | `/wards/:wardId/beds/:bedId` | `beds.changeStatus` (+ `beds.edit` for non-status fields) |
| `DELETE` | `/wards/:wardId/beds/:bedId` | `beds.delete` |
| `GET/POST` | `/encounters` | `encounters.view` / `encounters.create` |
| `GET/PATCH` | `/encounters/:id` | `encounters.view` / `encounters.edit` |
| `POST` | `/encounters/:id/close` | `encounters.close` |
| `DELETE` | `/encounters/:id` | `encounters.delete` |
| `GET` | `/lab/tests`, `/lab/tests/:id` | `labTests.view` |
| `POST/PATCH/DELETE` | `/lab/tests`, `/lab/tests/:id` | `labTests.create` / `.edit` / `.delete` |
| `GET` | `/lab/orders`, `/lab/orders/:id` | `labOrders.view` |
| `POST` | `/lab/orders` | `labOrders.create` |
| `POST` | `/lab/orders/:id/collect` | `labOrders.collect` |
| `POST` | `/lab/orders/:id/start` | `labOrders.process` |
| `POST` | `/lab/orders/:id/cancel` | `labOrders.cancel` |
| `POST` | `/lab/orders/:id/results` | `labResults.create` (+ `labResults.verify` to sign off) |
| `POST` | `/lab/orders/:id/results/:resultId/amend` | `labResults.amend` |
| `GET` | `/lab/orders/:id/report` | `labOrders.downloadReport` |
| `POST` | `/lab/orders/:id/report` (regenerate) | `labOrders.process` |
| `DELETE` | `/lab/orders/:id` | `labOrders.delete` |
| `GET` | `/lab/results` | `labResults.view` |
| `GET` | `/billing/line-items` | `billing.view` |

### Response shape

```jsonc
// success
{ "success": true, "message": "…", "data": {}, "meta": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 } }

// error — stack traces are included only when NODE_ENV !== 'production'
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "Validation failed",
  "details": [{ "field": "phone", "message": "Phone number is too short" }] } }
```

---

## Roles & permissions

`admin` · `doctor` · `nurse` · `receptionist` · `lab_tech` · `radiologist` ·
`pharmacist` · `accountant` · `staff`

**All authorization lives in one file: `server/src/config/permissions.js`.**
It is a `MODULE → ACTION → [roles]` table covering 29 modules. Routes name a
capability (`requirePermission(MODULES.PATIENTS, 'create')`), never a role, so
changing who may do what is a single-file edit — no route, controller or
component changes.

```
server/src/config/roles.js         the nine role constants
server/src/config/permissions.js   ★ the matrix — edit this to change access
server/src/middleware/rbac.js      requirePermission / requirePermissionOrOwn
```

`admin` is granted everything implicitly and so appears in no row; see the
comment at the top of `permissions.js`.

**The client holds no copy of the matrix.** The server sends the caller's
effective grants with `/auth/login`, `/auth/refresh` and `/auth/me`, and the UI
uses `useAuth().can(module, action)`. That prevents the two from drifting.
The API re-checks every request regardless — client checks are UX only.

> ⚠️ The permission table in your brief did not come through (Section 3 was a
> literal `[paste the role table…]` placeholder). The current matrix is a
> **derived default** — see ARCHITECTURE.md §4 for the full grid and the five
> judgement calls worth reviewing.

**Sanity-check the matrix from the shell:**

```bash
cd server
node --input-type=module -e "
import('./src/config/permissions.js').then(({ permissionsForRole, rolesWith }) => {
  console.log(JSON.stringify(permissionsForRole('nurse'), null, 2));
  console.log('who can approve a discount:', rolesWith('invoices','approveDiscount'));
});"
```

---

## Production notes

Before deploying:

- [ ] Set `NODE_ENV=production` (hides stack traces, forces `Secure` cookies)
- [ ] Generate fresh 32+ character JWT secrets; never reuse the dev ones
- [ ] Change the seeded admin password
- [ ] Set `CLIENT_ORIGIN` to the real front-end origin
- [ ] Serve over HTTPS and set `COOKIE_SECURE=true`
- [ ] Build the client (`cd client && npm run build`) and serve `client/dist` from a static host or reverse proxy
- [ ] Add rate limiting on `/auth/login` (Phase 14)
- [ ] Review the permission matrix in `server/src/config/permissions.js` against your real role table
- [ ] Set up MongoDB backups — including `auditLogs`, which is append-only and must be retained
- [ ] Decide whether PHI **read** access must be logged (the `view` audit action exists but is not wired to read routes)

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Missing required environment variable: MONGODB_URI` | Copy `.env.example` to `.env` in `server/` |
| `JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different` | Generate two distinct secrets |
| `[db] connection attempt 1/5 failed` | MongoDB isn't running, or `MONGODB_URI` is wrong |
| `401` immediately after login in the browser | Ensure you're using `http://localhost:5173` (the proxy origin), not `:5000` directly |
| CORS error in console | Add your origin to `CLIENT_ORIGIN` in `server/.env` |
| Login works but the page stays on `/login` | Check the browser is allowing cookies for `localhost` |
