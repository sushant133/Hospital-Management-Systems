# Build Plan

**Status legend:** ✅ complete · 🔵 in progress · ⚪ not started

Phases are exactly the 0–14 list from your brief.

> **Note on Phase 6.** You asked for phases 2–14 to be marked *not started*. Phase 6
> (Laboratory) is marked ✅ instead because it is genuinely built and running —
> it was completed in an earlier session against the previous phase numbering.
> Marking it "not started" would make this document wrong. Everything else
> matches your list.

| Phase | Name | Status |
|---|---|---|
| 0 | Scaffolding, auth, roles, permissions config, audit log middleware | ✅ complete |
| 1 | Patient registration/MPI + duplicate detection + departments/wards | ✅ complete |
| 2 | Appointment scheduling | ⚪ not started |
| 3 | EHR — encounters, vitals, SOAP notes, allergies, timeline | 🔵 partial (see below) |
| 4 | OPD/IPD workflow + bed/ward allocation | ⚪ not started |
| 5 | Staff management + attendance/shifts | 🔵 partial (see below) |
| 6 | Laboratory | ✅ complete |
| 7 | Radiology/X-ray | ⚪ not started |
| 8 | Pharmacy | ⚪ not started |
| 9 | General inventory | ⚪ not started |
| 10 | Billing | 🔵 partial (see below) |
| 11 | Insurance | ⚪ not started |
| 12 | Payroll/salary | ⚪ not started |
| 13 | Admin dashboard | ⚪ not started |
| 14 | Security hardening, testing, deployment prep | ⚪ not started |

**Why three phases are "partial".** Phases 3, 5 and 10 each have a foundation
that Phase 0/1/6 required and therefore already exists. Nothing was stubbed —
what is listed as built works end to end. The remainder of each phase is
untouched:

- **Phase 3** — `encounters` (visits, vitals, diagnoses) and embedded
  allergies/chronic conditions are built. **Missing:** the `clinicalNotes`
  collection with append-only SOAP notes and amendment chains, and the unified
  patient timeline.
- **Phase 5** — staff accounts, roles and admin CRUD are built (Phase 0 needed
  them). **Missing:** attendance, shifts and rostering.
- **Phase 10** — the `billingLineItems` shared ledger and `billing.service.js`
  are built, and lab charges flow into them. **Missing:** invoices, payments,
  partial payment, refunds/credit notes and discount approval.

---

## Phase 0 — Scaffolding, Auth, Roles, Permissions, Audit ✅

- [x] `/server` scaffold — Express 5, ESM, layered structure (config, models, middleware, modules, services, routes, utils)
- [x] MongoDB connection with retry, connection-event logging, graceful shutdown
- [x] `User` model — bcrypt (cost 12), `passwordHash` with `select: false`, `tokenVersion` for revocation
- [x] `Counter` model + `nextSequence()` for atomic human-readable IDs
- [x] JWT auth — access (15m) + refresh (7d) tokens in httpOnly cookies, `Authorization: Bearer` fallback
- [x] **Single permissions config** — `config/permissions.js`, 29 modules × ~155 role/action grants
- [x] **`requirePermission(module, action)`** middleware; validates the (module, action) pair at boot so typos crash at startup, not in production
- [x] `requirePermissionOrOwn(...)` for own-record access (own payslip, own attendance)
- [x] **Every route in the codebase migrated off ad-hoc role lists** — zero `requireRole` / `ROLE_GROUPS` references remain, server or client
- [x] Effective permissions served to the client via `/auth/login`, `/auth/refresh`, `/auth/me` — the client keeps no copy of the matrix
- [x] **`AuditLog` model** — append-only; `strict:'throw'` plus pre-hooks reject update/delete/re-save at the model layer
- [x] **`audit()` middleware** on every create/edit/delete route — field-level before/after diffs, credential redaction, written after response flush
- [x] Auth-event auditing — `login`, `login_failed` (with reason and IP), `password_change`, `password_reset`
- [x] Admin-only audit viewer — `GET /audit-logs` with filters, `GET /audit-logs/patient/:id` for "who touched this chart?"
- [x] zod `validate(schema)` middleware for body/params/query on every route
- [x] Centralized error handler — no stack traces in production, Mongoose/JWT/zod error normalization
- [x] Auth routes: login, refresh, logout, me, change-password
- [x] Staff account routes (admin): list, create, get, update, deactivate, restore, reset-password
- [x] Seed script — admin account + sample departments/wards/beds + lab catalogue
- [x] `/client` scaffold — Vite + React 18 + React Router 6 + Tailwind 3
- [x] `AuthContext` with session bootstrap, silent refresh on 401, `can(module, action)`
- [x] `ProtectedRoute` guarding on `[module, action]`, not on roles
- [x] App shell — permission-filtered sidebar, topbar, layout
- [x] UI kit — Button, Input, Select, Textarea, Card, Table, Modal, Badge, Spinner, Alert, EmptyState, PageHeader, Pagination
- [x] Login page + dashboard

## Phase 1 — Patient Registration / MPI + Departments & Wards ✅

- [x] `Patient` model — demographics, `nationalId`, embedded `medicalHistory`, auto MRN, search indexes
- [x] **MPI duplicate detection** (`services/mpi.service.js`) — weighted scoring across national ID, phone, email, date of birth, fuzzy names and gender; indexed candidate narrowing; normalized names; capped edit distance
- [x] **Blocking on registration** — score ≥ 70 returns `409 POSSIBLE_DUPLICATE_PATIENT` with the matches and the fields that matched
- [x] **Audited override** — needs `patients.overrideDuplicate` plus a ≥10-character written reason; the reason and the overridden matches are written to the audit log
- [x] `POST /patients/check-duplicates` — same search, creates nothing; called live as the form is typed
- [x] Duplicate warning UI — match cards with score, matched fields, links to the existing charts, override checkbox + reason capture, submit blocked until resolved
- [x] `Department`, `Ward`, `Bed` models with soft delete + audit fields
- [x] Patient API — list (paginated + search), create, get, update, medical-history update, soft delete, restore
- [x] Patient visit history endpoint (`GET /patients/:id/encounters`)
- [x] Department API — full CRUD (admin write, all-staff read)
- [x] Ward API — full CRUD + bed roster + occupancy summary
- [x] Bed API — create/update/delete, status transitions, availability filter
- [x] **Bed permission split** — nurses hold `beds.changeStatus` (cleaning/maintenance) but not `beds.edit`; the controller rejects attempts to change a bed's number, rate or notes without `edit`, so the narrower grant cannot be widened through the same route
- [x] Patient list page — search, pagination, status badges
- [x] Patient form page — create/edit, live duplicate check, client + server validation
- [x] Patient detail page — permission-filtered tabs: demographics · medical history · visits · lab
- [x] Departments admin page — table + create/edit modal
- [x] Wards admin page — table + create/edit modal + occupancy bar
- [x] Ward bed roster page — bed grid, status changes, add/remove beds

## Phase 2 — Appointment Scheduling ⚪

`appointments` collection · doctor availability & slot generation · booking,
rescheduling and cancellation with reason capture · walk-in queue with queue
numbers · check-in creating an `encounter` · daily schedule per doctor and
department · no-show tracking.

## Phase 3 — EHR 🔵

Built: `encounters` (visits, vitals, diagnoses), embedded allergies and chronic
conditions.

Remaining: `clinicalNotes` collection with **append-only SOAP notes** — a
correction writes a new version linked via `supersedes`/`supersededBy` with a
mandatory `amendmentReason`, and both stay readable (ARCHITECTURE.md §5) ·
structured vitals timeline · unified patient timeline merging encounters, notes,
orders, results and prescriptions in one chronological view.

## Phase 4 — OPD/IPD Workflow + Bed Allocation ⚪

Admission workflow from an encounter · bed assignment with `beds.status`
transitions and occupancy locking · ward/bed transfers with history · nursing
rounds · discharge summary and bed release · automatic per-day bed charges into
`billingLineItems` · live occupancy dashboard.

## Phase 5 — Staff Management + Attendance/Shifts 🔵

Built: staff accounts, role assignment, department assignment, admin CRUD,
password reset, deactivate/restore.

Remaining: `attendance` collection with shift check-in/out · shift roster and
publishing · leave tracking · overtime accumulation · per-department attendance
reporting. Feeds Phase 12 payroll.

## Phase 6 — Laboratory ✅

Test catalogue, ordering, sample tracking, result entry with reference ranges,
sign-off gate, automated PDF reports, critical-value flagging, and charges fed
into the shared billing ledger.

- [x] `LabTest` catalogue — priced tests, per-analyte reference + critical ranges, numeric and qualitative analytes
- [x] `LabOrder` — auto `LAB-000001`, snapshotted test name/specimen/price, status state machine
- [x] `LabResult` — one document per test per order, snapshotted reference ranges, abnormal/critical roll-ups
- [x] `BillingLineItem` shared charge ledger + `billing.service.js` (the only write path for charges)
- [x] `labResult.service.js` — value parsing (`<0.01`, `Negative`), reference-range evaluation, flagging
- [x] `labReport.service.js` — pdfkit renderer with letterhead, patient block, result tables, signatures, page numbering
- [x] Catalogue API — admin CRUD, retire blocked while orders are in progress
- [x] Order API — create (charges raised), collect, start, cancel (charges reversed), soft delete
- [x] Sample tracking — `ordered → collected → in-progress → completed`, illegal transitions rejected with 409
- [x] **Sign-off gate** — result entry (`labResults.create`) and verification (`labResults.verify`) are separate permissions; submitting straight to `verified` re-checks `verify` in the controller so the gate cannot be walked around via the request body
- [x] Amend verified results with a mandatory reason
- [x] Auto-completion — last verified test completes the order and generates the report
- [x] Report download via an authenticated, permission-gated route; `uploads/` is not statically served
- [x] Critical-value flagging and banner on the order detail page
- [x] Cross-order result search powering the patient lab timeline
- [x] Lab worklist, order detail, result entry with live flag preview, catalogue admin, new-order modal, patient lab tab

**Not yet built in this phase:** active critical-value *alerting* (pager/SMS/
in-app notification to the ordering doctor). Values are flagged and surfaced in
the UI; nothing is pushed. Belongs with a notification service.

## Phase 7 — Radiology / X-ray ⚪

`radiologyOrders` + `radiologyResults` · modality catalogue with pricing ·
scheduling · radiologist worklist · report authoring with findings/impression ·
**image file attachment** with the same non-static, permission-gated download
path as lab reports · verification and amendment · charges to `billingLineItems`.

## Phase 8 — Pharmacy ⚪

`drugs` (drug master) · `drugBatches` with per-batch expiry · `prescriptions` ·
`dispenses` · doctor prescribing from an encounter · **FEFO dispensing** driven
by the `{drugId, expiryDate}` index · **allergy check at dispense time** against
`patient.medicalHistory.allergies`, with an audited `overrideAllergyWarning` ·
expiry and low-stock alerts · quarantine/write-off of expired batches · pharmacy
charges to `billingLineItems`.

## Phase 9 — General Inventory ⚪

`inventoryItems` + `inventoryTransactions` · non-drug consumables and assets ·
receipts, issues to departments, adjustments, returns · reorder-level alerts ·
per-department consumption reporting.

## Phase 10 — Billing 🔵

Built: `billingLineItems` shared ledger, `billing.service.js`, lab charges
flowing in, read-only ledger endpoint with per-status totals.

Remaining: `invoices` — **consolidated invoice per encounter** aggregating
unbilled line items and flipping them to `invoiced` with an `invoiceId`
back-reference · `payments` with **partial payment** and balance tracking ·
**refunds and credit notes** (negative `payments` rows referencing the original)
· **discount approval** — `applyDiscount` and `approveDiscount` are already
separate permissions in the matrix, approval being admin-only · receipt
generation · outstanding-balance reporting.

## Phase 11 — Insurance ⚪

`insuranceProviders` master with plan and co-pay configuration ·
`patientPolicies` linking a patient to cover, with eligibility verification ·
`preAuthorizations` — request, submission, approval/rejection, authorization
codes, expiry · `claims` — build from an invoice, submit, track through
under-review / approved / partially-approved / rejected / settled, support
resubmission · **co-pay calculation** splitting an invoice into insurer-covered
and patient-responsible amounts · aging and settlement reporting.

## Phase 12 — Payroll / Salary ⚪

`payrollRuns` + `payslips` · salary structure (basic, allowances, deductions) ·
**attendance-driven pay** from Phase 5 · approval workflow (`payroll.approve` is
admin-only; accountants build runs) · payslip export · own-payslip self-service
via `requirePermissionOrOwn`.

**Access separation** from patient billing is already enforced by the matrix:
`payroll` is a distinct module with its own grants. See ARCHITECTURE.md §4
decision 3 — `accountant` currently holds both `payroll` and `invoices`, which
you may want to split.

## Phase 13 — Admin Dashboard ⚪

Revenue (daily/monthly, by department, by payer) · bed occupancy and average
length of stay · inventory burn and expiry exposure · attendance and overtime ·
per-department KPIs (patient volume, turnaround times, revenue per bed) ·
date-range filtering and CSV export · role-specific dashboard variants driven by
`reports.viewOperational` / `viewFinancial` / `viewClinical`.

## Phase 14 — Security Hardening, Testing, Deployment ⚪

Integration tests per module, with **a test asserting the permission matrix
itself** (every role × module × action) · rate limiting on `/auth/login` ·
account lockout after repeated `login_failed` audit entries · helmet/CSP review ·
index audit against real query patterns · request-id correlation between logs and
audit entries · PHI **read-access** logging (the `view` audit action exists and is
unwired by default) · secret rotation runbook · Docker Compose · production env
checklist · backup/restore runbook including the append-only audit collection.
