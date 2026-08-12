# Hospital Management System — Architecture

Single-hospital HMS with multiple departments and wards. Stack: MongoDB, Express.js, React, Node.js (MERN).

> **⚠️ The permissions matrix in your brief did not come through.** Section 3 of
> your message reads `[paste the role table from Section 3 above]` — the table
> itself was never pasted. §4 below documents a **default matrix I derived** from
> the nine roles you named and normal hospital practice. It is implemented in one
> file (`server/src/config/permissions.js`) and every route reads from it, so
> replacing it with your real table is a single-file edit with no code changes
> anywhere else. **Please review §4 before treating authorization as settled.**

---

## 1. Folder Structure

### `/server`

```
server/
├── package.json
├── .env.example
├── .gitignore
└── src/
    ├── server.js                 # Entry point: connects DB, starts HTTP listener
    ├── app.js                    # Express app: middleware chain, route mounting
    ├── seed.js                   # Idempotent seed: admin user + sample departments/wards
    │
    ├── config/
    │   ├── index.js              # Central env config, validated at boot
    │   ├── roles.js              # The nine role constants (no env dependency)
    │   ├── permissions.js        # ★ THE PERMISSION MATRIX — single source of truth
    │   └── db.js                 # Mongoose connection + graceful shutdown
    │
    ├── models/                   # Mongoose schemas — ONE file per collection
    │   ├── Counter.js            # Atomic sequence generator (MRN, encounter no, invoice no)
    │   ├── User.js               # Staff login accounts (all roles)
    │   ├── AuditLog.js           # Append-only compliance trail
    │   ├── Patient.js
    │   ├── Department.js
    │   ├── Ward.js
    │   ├── Bed.js
    │   ├── Encounter.js
    │   ├── LabTest.js
    │   ├── LabOrder.js
    │   ├── LabResult.js
    │   ├── BillingLineItem.js
    │   ├── plugins/auditable.js  # soft delete + createdBy/updatedBy, applied to every collection
    │   └── index.js              # Barrel export
    │
    ├── middleware/
    │   ├── auth.js               # requireAuth — verifies JWT, loads req.user
    │   ├── rbac.js               # requirePermission(module, action) — reads the matrix
    │   ├── audit.js              # audit({action, resourceType}) — writes the trail
    │   ├── validate.js           # validate(schema) — zod body/params/query validation
    │   ├── notFound.js           # 404 handler
    │   └── errorHandler.js       # Centralized error → JSON (no stack traces in prod)
    │
    ├── modules/                  # Feature modules: route + controller + validation
    │   ├── auth/                 # login, refresh, logout, me, change-password
    │   ├── users/                # Admin-managed staff accounts
    │   ├── auditLogs/            # Read-only audit viewer
    │   ├── patients/             # MPI: registration, demographics, medical history
    │   ├── departments/
    │   ├── wards/                # Wards + nested beds
    │   ├── encounters/           # Visits / admissions
    │   ├── labTests/             # Lab catalogue (admin-managed reference data)
    │   ├── labOrders/            # Orders, sample tracking, results, reports
    │   └── billing/              # Read-only view of the shared charge ledger
    │
    ├── services/                 # Cross-module logic; no HTTP concerns
    │   ├── mpi.service.js        # Duplicate detection & match scoring
    │   ├── billing.service.js    # The ONLY way a module raises a patient charge
    │   ├── labResult.service.js  # Reference-range evaluation & flagging
    │   └── labReport.service.js  # PDF report rendering (pdfkit)
    │
    ├── routes/
    │   └── index.js              # Mounts all modules under /api/v1
    │
    └── utils/
        ├── ApiError.js           # Operational error with statusCode + code
        ├── asyncHandler.js       # Promise wrapper — forwards rejections to error middleware
        ├── sendResponse.js       # Uniform success envelope
        ├── sequence.js           # nextSequence(name) using Counter
        ├── commonSchemas.js      # Shared zod primitives
        └── queryHelpers.js       # Pagination, sorting, soft-delete scoping
```

**Module folder rule.** A module owns exactly three files: `<name>.routes.js`
(wiring + guards), `<name>.controller.js` (HTTP handlers), `<name>.validation.js`
(zod schemas). Logic needed by two modules moves to `services/`. Controllers
never import another module's controller.

### `/client`

```
client/
├── package.json
├── vite.config.js                # Vite + React, /api proxy to server in dev
├── tailwind.config.js
├── postcss.config.js
├── index.html
└── src/
    ├── main.jsx                  # React root, Router + AuthProvider
    ├── App.jsx                   # Route table (public vs protected)
    ├── index.css                 # Tailwind directives + design tokens
    │
    ├── lib/
    │   ├── apiClient.js          # fetch wrapper: credentials, JSON, error normalization
    │   └── format.js             # Date/name/currency formatting helpers
    │
    ├── app/
    │   ├── AuthContext.jsx       # Session + permissions, login/logout, can()
    │   ├── ProtectedRoute.jsx    # Permission guard around route subtrees
    │   ├── permissions.js        # Module name constants + grant-map helpers
    │   └── roles.js              # Role constants & display labels ONLY
    │
    ├── components/
    │   ├── Layout.jsx            # App shell: sidebar + topbar + <Outlet/>
    │   ├── Sidebar.jsx           # Permission-filtered navigation
    │   ├── Topbar.jsx
    │   └── ui/                   # Button, Input, Select, Card, Table, Modal,
    │                             # Badge, Spinner, EmptyState, PageHeader, Alert
    │
    └── features/                 # ONE folder per module — page + api + local components
        ├── auth/LoginPage.jsx
        ├── dashboard/DashboardPage.jsx
        ├── patients/
        │   ├── patientsApi.js
        │   ├── PatientListPage.jsx
        │   ├── PatientFormPage.jsx      # Create + edit, with live duplicate check
        │   ├── PatientDetailPage.jsx    # Demographics · history · visits · lab
        │   ├── DuplicateWarning.jsx     # MPI match panel + override capture
        │   └── MedicalHistoryTab.jsx
        ├── departments/
        ├── wards/
        └── lab/
```

> `PatientLabTab.jsx` is the one deliberate exception to "no feature imports
> another feature": the patient record composes it as a tab. The dependency
> points patients → lab, never the reverse, so the lab feature stays self-contained.

**Feature folder rule:** each `features/<module>/` owns its API calls, pages, and
module-only components. Shared UI lives in `components/ui/`. No feature imports
from another feature — shared logic moves up to `lib/` or `components/`.

---

## 2. MongoDB Collections

Every collection for the full system is listed. **✅** marks those implemented
today; the rest are specified here so relationships and field names stay
consistent as later phases land.

| # | Collection | Purpose | Phase |
|---|---|---|---|
| 1 | `users` | Staff login accounts, all roles | ✅ 0 |
| 2 | `counters` | Atomic sequence generator for human-readable IDs | ✅ 0 |
| 3 | `auditLogs` | Append-only security/compliance trail | ✅ 0 |
| 4 | `patients` | Patient master index — demographics + EMR summary | ✅ 1 |
| 5 | `departments` | Hospital departments | ✅ 1 |
| 6 | `wards` | Wards, each belonging to a department | ✅ 1 |
| 7 | `beds` | Individual beds within a ward | ✅ 1 |
| 8 | `appointments` | Doctor calendars, walk-in queue, bookings | 2 |
| 9 | `encounters` | Visits/admissions — the clinical spine | ✅ 3 |
| 10 | `clinicalNotes` | Append-only SOAP notes with edit history | 3 |
| 11 | `labTests` | Lab catalogue — priced tests + reference ranges | ✅ 6 |
| 12 | `labOrders` | Lab test requests | ✅ 6 |
| 13 | `labResults` | Lab result values per order | ✅ 6 |
| 14 | `radiologyOrders` | Imaging requests | 7 |
| 15 | `radiologyResults` | Imaging reports + image attachments | 7 |
| 16 | `drugs` | Drug master — the formulary | 8 |
| 17 | `drugBatches` | Batch-level stock with expiry dates | 8 |
| 18 | `prescriptions` | Medication orders per encounter | 8 |
| 19 | `dispenses` | Dispensing events (FEFO batch draw-down) | 8 |
| 20 | `inventoryItems` | General (non-drug) consumables & assets | 9 |
| 21 | `inventoryTransactions` | Stock in/out movements | 9 |
| 22 | `billingLineItems` | **Shared charge ledger** — written by every revenue module | ✅ 10 |
| 23 | `invoices` | Consolidated patient bills, one per encounter | 10 |
| 24 | `payments` | Payments, refunds and credit notes against invoices | 10 |
| 25 | `insuranceProviders` | Insurer master with plan/tariff config | 11 |
| 26 | `patientPolicies` | A patient's cover under a provider | 11 |
| 27 | `preAuthorizations` | Approval requests before a chargeable service | 11 |
| 28 | `claims` | Post-service claims and their settlement status | 11 |
| 29 | `payrollRuns` | Monthly payroll batches | 12 |
| 30 | `payslips` | Per-staff payslip within a run | 12 |
| 31 | `attendance` | Staff shift check-in/out | 12 |

### Implemented schemas

#### `users`
```
_id, employeeId (unique, EMP-00001), email (unique, lowercase),
passwordHash, firstName, lastName, phone, role (enum, see §4),
departmentId → departments, specialization, licenseNumber,
lastLoginAt, mustChangePassword, tokenVersion,
isActive, deletedAt, deletedBy, createdBy, updatedBy, createdAt, updatedAt
```
- `passwordHash` has `select: false` — never returned unless explicitly requested.
- Compound index on `{ role, isActive }` for staff directory filtering.

#### `auditLogs` — append-only
```
_id, userId → users, userName (snapshot), userRole (snapshot),
action (create|update|delete|restore|view|export|login|login_failed|logout|
        password_change|password_reset|verify|amend|cancel|approve|dispense|override),
module (permission module the route was gated on), resourceType, resourceId, resourceRef,
patientId → patients, encounterId → encounters,
changes (field-level {from,to} diff, credentials redacted), reason,
method, path, statusCode, outcome (success|failure), ipAddress, userAgent,
createdAt
```
- **Not** given the `auditable` plugin: audit rows have no soft delete, no
  `updatedBy` and no edit path. `strict: 'throw'` plus pre-hooks on `updateOne`,
  `findOneAndUpdate`, `deleteOne`, `deleteMany` and re-`save` reject mutation at
  the model layer. A mutable audit log is not an audit log.
- Indexed on `{createdAt}`, `{resourceType, resourceId, createdAt}`,
  `{userId, createdAt}` and `{patientId, createdAt}` — the four questions the
  viewer actually asks.

#### `patients`
```
_id, mrn (unique, MRN-000001),
firstName, lastName, dateOfBirth, gender, bloodGroup, maritalStatus,
phone, email, nationalId,
address { line1, line2, city, state, postalCode, country },
emergencyContact { name, relationship, phone },
insurance { provider, policyNumber, validTill },   ← superseded by patientPolicies in Phase 11
medicalHistory {
  allergies: [{ substance, reaction, severity, notedAt }],
  chronicConditions: [{ condition, diagnosedOn, status, notes }],
  pastSurgeries: [{ procedure, performedOn, hospital, notes }],
  currentMedications: [{ name, dosage, frequency, startedOn }],
  familyHistory: [{ relation, condition, notes }],
  notes
},
status (active | deceased | inactive), registeredBy → users,
isActive, deletedAt, deletedBy, createdBy, updatedBy, createdAt, updatedAt
```
- `nationalId` is indexed and sparse but **deliberately not unique**: walk-ins
  and emergencies arrive without one, and a genuine data-entry collision should
  be shown to a human rather than rejected by the database. It is the
  highest-weighted signal in the MPI check instead (§3).
- `medicalHistory` is **embedded**, not a separate collection: it is always read
  with the patient, is bounded in size, and has no independent lifecycle.
  Per-visit clinical data lives in `encounters` and `clinicalNotes`.
- `insurance` is a Phase-1 convenience field. Phase 11 moves cover to
  `patientPolicies`, which supports multiple concurrent policies and co-pay rules.

#### `departments`
```
_id, code (unique, uppercase), name, description,
headOfDepartmentId → users, floor, phone, extension,
isActive, deletedAt, deletedBy, createdBy, updatedBy, createdAt, updatedAt
```

#### `wards`
```
_id, code (unique), name, departmentId → departments,
type (general | private | semi-private | icu | nicu | hdu | isolation | maternity | emergency),
gender (male | female | mixed), floor, totalBeds (denormalized count),
inChargeId → users,
isActive, deletedAt, deletedBy, createdBy, updatedBy, createdAt, updatedAt
```

#### `beds`
```
_id, bedNumber, wardId → wards,
status (available | occupied | reserved | maintenance | cleaning),
currentPatientId → patients, currentEncounterId → encounters,
dailyRate, notes,
isActive, deletedAt, deletedBy, createdBy, updatedBy, createdAt, updatedAt
```
- Unique compound index `{ wardId, bedNumber }`.
- Separate collection rather than an array on `ward` because beds are
  individually assignable, queried across wards ("all available ICU beds"), and
  referenced by encounters and billing.

#### `encounters`
```
_id, encounterNumber (unique, ENC-000001), patientId → patients,
type (opd | ipd | emergency | daycare), status (open | admitted | discharged | cancelled),
departmentId → departments, attendingDoctorId → users,
chiefComplaint, diagnosis: [{ code, description, type }],
vitals { temperatureC, pulseBpm, respiratoryRate, systolicBp, diastolicBp, spo2, weightKg, heightCm, recordedAt },
admission { wardId → wards, bedId → beds, admittedAt, dischargedAt, dischargeSummary, dischargeType },
startedAt, endedAt, notes,
isActive, deletedAt, deletedBy, createdBy, updatedBy, createdAt, updatedAt
```

#### `labTests` — the priced catalogue
```
_id, code (unique, uppercase), name, description,
departmentId → departments, specimen (blood | serum | ... | other),
category, price, turnaroundHours, preparationNotes,
analytes: [{ code, name, valueType (numeric|text), unit,
             refLow, refHigh, criticalLow, criticalHigh,
             expectedValues[], normalValue, displayOrder }],
isActive, deletedAt, deletedBy, createdBy, updatedBy, createdAt, updatedAt
```
- **Reference ranges live here, not on results.** Results snapshot the range they
  were judged against, so revising a range never re-interprets historical results.

#### `labOrders`
```
_id, orderNumber (unique, LAB-000001),
patientId → patients, encounterId → encounters, orderedBy → users (doctor),
tests: [{ labTestId → labTests, code, name, specimen, price }],   // snapshot
priority (routine | urgent | stat),
status (ordered | collected | in-progress | completed | cancelled),
clinicalNotes, sampleId,
collectedAt, collectedBy → users, startedAt, completedAt,
cancelledAt, cancellationReason,
totalPrice (derived), reportPath, reportGeneratedAt,
isActive, deletedAt, deletedBy, createdBy, updatedBy, createdAt, updatedAt
```
- `tests[]` **snapshots** name/specimen/price at order time — a later catalogue
  price change never rewrites what was ordered or billed.
- Status is a state machine; only the transitions in `LAB_STATUS_TRANSITIONS`
  are accepted. Anything else returns 409.

#### `labResults`
```
_id, labOrderId → labOrders, patientId → patients, encounterId → encounters,
labTestId → labTests, testCode, testName,
values: [{ analyteCode, analyteName, value (string), numericValue,
           unit, refLow, refHigh, referenceRange, flag, notes }],
hasAbnormalValues, hasCriticalValues,
status (preliminary | verified | amended),
performedBy → users, verifiedBy → users, verifiedAt,
technicianNotes, interpretation,
isActive, deletedAt, deletedBy, createdBy, updatedBy, createdAt, updatedAt
```
- One document per **test** per order — unique index `{ labOrderId, labTestId }`.
- `value` is a string so `<0.01`, `Negative` and `12.5` are all storable;
  `numericValue` carries the parsed form when one exists.

#### `billingLineItems` — the shared charge ledger
```
_id, patientId → patients, encounterId → encounters,
sourceType (lab | radiology | pharmacy | bed | procedure | consultation | other),
sourceId (e.g. labOrders._id), sourceRef (e.g. 'LAB-000001'),
itemCode, description, quantity, unitPrice, lineTotal (derived),
departmentId → departments,
status (unbilled | invoiced | cancelled), invoiceId → invoices,
chargedAt, notes,
isActive, deletedAt, deletedBy, createdBy, updatedBy, createdAt, updatedAt
```
- **Every revenue module writes here; no module builds its own invoice.** Charges
  are raised through `services/billing.service.js` only.
- Phase 10 invoicing selects `{ encounterId, status: 'unbilled' }`, sums the rows
  into an `invoices` document, then flips them to `invoiced` with `invoiceId` set.

### Planned schemas — key fields

Listed so later phases inherit consistent names and references.

- **`appointments`** — `appointmentNumber`, `patientId`, `doctorId`, `departmentId`, `scheduledFor`, `durationMinutes`, `status` (booked/checked-in/completed/no-show/cancelled), `encounterId` (set on check-in), `isWalkIn`, `queueNumber`, `reason`, `rescheduledFrom`.
- **`clinicalNotes`** — `patientId`, `encounterId`, `authorId`, `noteType` (soap/progress/nursing/discharge), `subjective`, `objective`, `assessment`, `plan`, `signedAt`, `supersededBy`, `supersedes`, `amendmentReason`, `version`. **Append-only — see §5.**
- **`radiologyOrders`** — `orderNumber`, `patientId`, `encounterId`, `orderedBy`, `modality` (xray/ct/mri/ultrasound), `bodyPart`, `priority`, `status`, `scheduledFor`, `price`.
- **`radiologyResults`** — `radiologyOrderId`, `patientId`, `encounterId`, `findings`, `impression`, `attachments: [{ path, filename, mimeType, sizeBytes, description }]`, `status` (preliminary/verified/amended), `reportedBy`, `verifiedBy`, `verifiedAt`, `reportPath`.
- **`drugs`** (drug master) — `drugCode`, `name`, `genericName`, `form` (tablet/syrup/injection…), `strength`, `unit`, `atcCode`, `manufacturer`, `sellingPrice`, `reorderLevel`, `isControlled`, `allergenClasses: []` ← matched against `patient.medicalHistory.allergies` at dispense.
- **`drugBatches`** — `drugId`, `batchNo`, `expiryDate`, `quantityReceived`, `quantityOnHand`, `costPrice`, `supplier`, `receivedAt`, `status` (active/expired/quarantined/depleted). Indexed `{ drugId, expiryDate }` — **the FEFO index**.
- **`prescriptions`** — `patientId`, `encounterId`, `prescribedBy`, `items: [{ drugId, drugName, dosage, frequency, durationDays, route, instructions, quantity, quantityDispensed }]`, `status` (pending/partially-dispensed/dispensed/cancelled).
- **`dispenses`** — `dispenseNumber`, `patientId`, `encounterId`, `prescriptionId`, `items: [{ drugId, batchId, batchNo, expiryDate, quantity, unitPrice, lineTotal }]`, `allergyWarnings: [{ drugId, substance, severity, overriddenBy, overrideReason }]`, `dispensedBy`, `dispensedAt`.
- **`inventoryItems`** — `itemCode`, `name`, `category`, `unit`, `quantityOnHand`, `reorderLevel`, `unitCost`, `location`, `isAsset`.
- **`inventoryTransactions`** — `itemId`, `type` (receipt/issue/adjustment/return), `quantity`, `departmentId`, `reference`, `performedBy`, `occurredAt`.
- **`invoices`** — `invoiceNumber`, `patientId`, `encounterId`, `subtotal`, `discountAmount`, `discountReason`, `discountApprovedBy`, `taxAmount`, `total`, `amountPaid`, `balance`, `insuranceCoveredAmount`, `patientResponsibleAmount`, `status` (draft/issued/partially-paid/paid/void). **Line items are NOT embedded** — they live in `billingLineItems` and reference the invoice via `invoiceId`.
- **`payments`** — `paymentNumber`, `invoiceId`, `patientId`, `type` (payment/refund/credit-note), `amount` (negative for refunds/credit notes), `method` (cash/card/insurance/transfer/wallet), `reference`, `reason`, `receivedBy`, `receivedAt`, `reversalOf`.
- **`insuranceProviders`** — `code`, `name`, `contactPerson`, `phone`, `email`, `address`, `claimSubmissionEmail`, `defaultCoPayPercent`, `settlementDays`, `isActive`.
- **`patientPolicies`** — `patientId`, `providerId`, `policyNumber`, `planName`, `memberName`, `relationshipToMember`, `coPayPercent`, `coverageLimit`, `validFrom`, `validTill`, `status` (active/expired/suspended), `verifiedAt`, `verifiedBy`.
- **`preAuthorizations`** — `preAuthNumber`, `patientId`, `encounterId`, `policyId`, `providerId`, `requestedServices: [{ description, estimatedAmount }]`, `estimatedTotal`, `status` (draft/submitted/approved/partially-approved/rejected/expired), `approvedAmount`, `authorizationCode`, `submittedAt`, `decisionAt`, `decisionNotes`.
- **`claims`** — `claimNumber`, `patientId`, `encounterId`, `invoiceId`, `policyId`, `providerId`, `preAuthId`, `claimedAmount`, `approvedAmount`, `settledAmount`, `rejectedAmount`, `rejectionReason`, `status` (draft/submitted/under-review/approved/partially-approved/rejected/settled/resubmitted), `submittedAt`, `settledAt`.
- **`payrollRuns`** — `period` (YYYY-MM), `status` (draft/approved/paid), `totalGross`, `totalNet`, `approvedBy`, `approvedAt`, `processedAt`.
- **`payslips`** — `payrollRunId`, `userId`, `basicSalary`, `allowances: [{ label, amount }]`, `deductions: [{ label, amount }]`, `gross`, `net`, `daysPresent`, `daysAbsent`, `overtimeHours`.
- **`attendance`** — `userId`, `date`, `checkInAt`, `checkOutAt`, `shift` (morning/evening/night), `status` (present/absent/leave/half-day), `hoursWorked`, `approvedBy`.

---

## 3. Key Relationships

```
departments ──1:N──> wards ──1:N──> beds
departments ──1:N──> users (staff assignment)
departments ──1:N──> encounters

patients ──1:N──> encounters ──1:1(optional)──> beds (via encounter.admission.bedId)
patients ──1:N──> appointments ──0:1──> encounters (created at check-in)
encounters ──1:N──> clinicalNotes (append-only chain via supersedes/supersededBy)

labTests ──N:M──> labOrders (snapshotted into labOrder.tests[])
encounters ──1:N──> labOrders ──1:N──> labResults
encounters ──1:N──> radiologyOrders ──1:N──> radiologyResults
encounters ──1:N──> prescriptions ──1:N──> dispenses
drugs ──1:N──> drugBatches ──drawn down by──> dispenses (FEFO)

                    ┌─ labOrders ──┐
encounters ──1:N──> │ radiology    │ ──raise──> billingLineItems ──N:1──> invoices ──1:N──> payments
                    │ pharmacy     │            (unbilled → invoiced)         │
                    │ bed / proc   │                                          └──> claims ──N:1──> insuranceProviders
                    └──────────────┘
patients ──1:N──> patientPolicies ──N:1──> insuranceProviders
patientPolicies ──1:N──> preAuthorizations ──0:1──> claims

inventoryItems ──1:N──> inventoryTransactions
users ──1:N──> attendance
users ──1:N──> payslips ──N:1──> payrollRuns
users ──authors──> every medical & financial record (createdBy) ──> auditLogs
```

### The `patientId` + `encounterId` rule

Every clinical or financial artifact carries **both**:

- `patientId` — enables the longitudinal record ("all lab results for this
  patient, ever") without a join through encounters.
- `encounterId` — ties the artifact to the visit that generated it, which is
  what billing, discharge summaries and clinical audit need.

This applies to `clinicalNotes`, `labOrders`, `labResults`, `radiologyOrders`,
`radiologyResults`, `prescriptions`, `dispenses`, `billingLineItems`, `invoices`,
`preAuthorizations` and `claims`. The denormalization is deliberate: a single
`encounterId` would make patient-history queries a two-stage lookup on the
hottest read path in the system.

**Nothing is duplicated per module.** A module never copies patient demographics,
drug details or prices into its own documents *except* as an explicit,
documented **snapshot** where the historical value must not move (`labOrder.tests[]`
prices, `labResult.values[]` reference ranges, `dispenses.items[]` batch and
price). Snapshots are point-in-time facts; everything else is a reference.

### Master Patient Index — duplicate detection

`services/mpi.service.js`. Registering the same human twice is the most expensive
data-quality failure in a hospital system: allergies land on one chart and the
prescription on the other.

**Scoring.** Candidate records are narrowed by an indexed signal (national ID,
email, phone suffix, exact date of birth, or a last name sharing its first three
letters), then scored:

| Signal | Weight |
|---|---|
| `nationalId` exact | 100 |
| `phone` (last 9 digits) | 35 |
| `email` exact | 25 |
| `dateOfBirth` same day | 25 |
| `lastName` exact / near (edit distance ≤ 2) | 20 / 10 |
| `firstName` exact / near | 15 / 7 |
| `gender` | 5 |

Names are normalized (case, accents, punctuation stripped) so `O'Brien` matches
`obrien`. Thresholds: **≥ 70 blocks** registration, **≥ 40 warns**.

**Behaviour.** `POST /patients` runs the check before creating. A blocking match
returns `409 POSSIBLE_DUPLICATE_PATIENT` with the matching records and the fields
that matched. Registering anyway requires the `patients.overrideDuplicate`
permission *and* a written reason of at least 10 characters, and the override —
with its reason and the matches that were overridden — is written to the audit
log. `POST /patients/check-duplicates` runs the same search without creating
anything; the registration form calls it as the user types.

**Deliberate choices.**
- Duplicate likelihood is **computed, never stored**. A phone-number correction
  can create or dissolve a match, so a cached `possibleDuplicates` field would be
  wrong more often than right.
- Soft-deleted patients **are** searched: a record deactivated in error is exactly
  what gets re-registered as a duplicate.
- **Accepted blind spot:** two records sharing *none* of the narrowing signals
  (different name, DOB, phone, email and national ID) will not be detected. A
  full pairwise comparison does not scale and would not be more correct.

**Not built:** record *merging*. Detection prevents new duplicates; merging two
existing charts safely requires re-pointing encounters, orders, results and
ledger rows in one transaction, and belongs with the modules that own them.
`patients.merge` is reserved in the matrix (admin-only) for that work.

### Referential integrity

Enforced in the service layer, not by the database. Before creating a child
document, the controller verifies the parent exists and is active (creating an
encounter validates `patientId`, `departmentId`, `attendingDoctorId`). Mongoose
`ref` is used for `populate()`, not as a foreign-key constraint.

### Charges are raised through one service

No module writes `billingLineItems` directly — `services/billing.service.js`
exposes `createCharges()` and `cancelChargesForSource()`, so every revenue module
produces identically shaped rows and cancellation semantics stay consistent. Lab
charges are raised when the order is **placed** and reversed on cancellation;
rows already pulled onto an invoice are left alone and need a credit note instead.

---

## 4. Auth, Roles & Permissions

### Strategy

- **Password storage** — bcrypt, cost factor 12. `passwordHash` is `select: false`
  so it never leaks through a stray `.find()`.
- **Tokens** — JWT (HS256), two-token scheme:
  - **Access token**, 15-minute TTL, payload `{ sub, role, tokenVersion }`.
  - **Refresh token**, 7-day TTL, separate secret, rotated on every refresh.
- **Transport** — both tokens in **httpOnly, SameSite=Strict cookies** (`Secure`
  in production), out of reach of XSS-injected JavaScript. `credentials: 'include'`
  on the client; CORS locked to the configured origin with `credentials: true`.
  The access token is *also* accepted via `Authorization: Bearer <token>` so
  non-browser clients work without a cookie jar. Cookie is checked first.
- **CSRF** — `SameSite=Strict` blocks cross-site form posts, and state-changing
  routes reject non-JSON content types, which blocks simple-form CSRF.
- **Revocation** — `tokenVersion` on the user document. Bumping it invalidates
  every outstanding token for that user (password change, deactivation).

### Roles

| Role (stored value) | Scope |
|---|---|
| `admin` | Full access. Sole manager of staff accounts, facility configuration and the audit log. |
| `doctor` | Patient records, encounters, diagnoses, clinical notes, orders (lab/radiology), prescribing. |
| `nurse` | Patient records, vitals, nursing notes, specimen collection, bed status, medication administration. |
| `receptionist` | Registration & demographics, appointments, check-in, policies, invoicing and payment collection. No clinical data entry. |
| `lab_tech` | Lab worklist, specimen tracking, result entry and verification. |
| `radiologist` | Radiology worklist, imaging reports, image attachment. |
| `pharmacist` | Prescription queue, dispensing, drug master and batch inventory. |
| `accountant` | Billing, invoices, payments, insurance claims, payroll, financial reporting. |
| `staff` | Baseline. Own profile, own attendance, own payslip, staff directory, inventory. No patient data. |

Role strings are `snake_case` (`lab_tech`) and defined once in
`server/src/config/roles.js`.

### The permission matrix — one config, no scattered checks

**`server/src/config/permissions.js` is the only place authorization is decided.**
It is a `MODULE → ACTION → [roles]` table across 29 modules. Every protected route
is gated by:

```js
router.post(
  '/',
  requireAuth,
  requirePermission(MODULES.PATIENTS, 'create'),
  validate({ body: createPatientSchema }),
  audit({ action: 'create', resourceType: 'Patient' }),
  controller.createPatient,
);
```

Routes name a **capability**, never a role. Consequences:

- Changing who may do what is a one-file edit. No route, controller or component
  changes.
- "Who can cancel a lab order?" is answered by reading one table, not by grepping
  the routing layer.
- `requirePermission()` calls `assertPermissionExists()` at *route-definition*
  time, so a typo like `requirePermission('patient', 'view')` crashes the server
  at boot rather than silently allowing or denying traffic in production.

**Admin is implicit.** `admin` is absent from every row; `can()` grants it
everything. Listing it in all ~155 rows would bury the interesting distinctions.
`permissionsForRole('admin')` still expands to the complete explicit list, so the
client, the docs and any audit see the full grant. Removing the short-circuit and
listing roles explicitly is the only change needed to constrain admin.

**Actions.** `view` covers list and detail. `create`/`edit`/`delete` are the
standard triple, where `delete` always means the soft delete. `restore` is
separate from `edit` because undoing a deletion is a privileged correction.
Workflow verbs (`verify`, `collect`, `dispense`, `approveDiscount`, `amend`,
`overrideDuplicate`, …) exist where a step needs a narrower gate than plain `edit`.

**Own-record access.** `requirePermissionOrOwn(module, action, ownAction, isOwner)`
covers "view any payslip" versus "view my own payslip" without a second matrix.

#### The default matrix — ⚠️ REVIEW THIS

Your Section 3 table did not arrive, so the following was derived from the nine
roles you named. Reading of the grid: **A** = admin (implicit), **D** doctor,
**N** nurse, **R** receptionist, **L** lab tech, **X** radiologist, **P**
pharmacist, **$** accountant, **S** staff.

| Module | view | create | edit | delete | special |
|---|---|---|---|---|---|
| `patients` | D N R L X P $ | R D N | R D N | R | `checkDuplicates` R D N · `overrideDuplicate` R · `merge` A · `viewMedicalHistory` D N P · `editMedicalHistory` D N |
| `departments` | all | A | A | A | `restore` A |
| `wards` | all | A | A | A | `restore` A |
| `beds` | all | A | A | A | `changeStatus` N · `assign` N D R |
| `appointments` | D N R | R D N | R D N | R | `checkIn` R N · `cancel` R D N |
| `encounters` | D N R L X P $ | R D N | D N | D | `recordVitals` N D · `close` D |
| `clinicalNotes` | D N | D N | — | — | `amend` D N (**no edit/delete by design**) |
| `staff` | A | A | A | A | `resetPassword` A · `viewDirectory` all |
| `attendance` | A | A | A | A | `recordOwn` all · `manageShifts` A |
| `labTests` | D N L R $ | A | A | A | `restore` A |
| `labOrders` | D N L $ | D N | D L | A | `collect` L N · `process` L · `cancel` D L · `downloadReport` D N L |
| `labResults` | D N L | L | — | — | `verify` L · `amend` L |
| `radiologyOrders` | D N X $ | D N | D X | A | `schedule` X R · `cancel` D X · `downloadReport` D N X |
| `radiologyResults` | D N X | X | — | — | `verify` X · `amend` X · `attachImages` X |
| `prescriptions` | D N P | D | D | A | `cancel` D P |
| `drugs` | D N P $ | P | P | P | `restore` A |
| `drugBatches` | P $ N | P | P | A | `adjust` P |
| `dispensing` | P D N | P | — | — | `return` P · `overrideAllergyWarning` P |
| `inventory` | $ N P R S | A | A | A | `transact` N P S |
| `billing` | $ R D | $ R | $ | — | `cancel` $ |
| `invoices` | $ R D | $ R | $ | A | `applyDiscount` $ R · **`approveDiscount` A** · `void` $ |
| `payments` | $ R | $ R | — | — | `refund` $ |
| `insuranceProviders` | $ R D | $ | $ | A | `restore` A |
| `patientPolicies` | $ R D | R $ | R $ | $ | `verifyEligibility` R $ |
| `preAuthorizations` | $ R D | R $ | $ R | — | `submit` $ · `recordDecision` $ |
| `claims` | $ R | $ | $ | — | `submit` $ · `recordDecision` $ |
| `payroll` | $ | $ | $ | — | **`approve` A** · `viewOwn` all |
| `reports` | — | — | — | — | `viewOperational` D N $ · `viewFinancial` $ · `viewClinical` D · `export` $ |
| `auditLogs` | **A only** | — | — | — | `export` A · **never writable through the API** |

**Judgement calls worth your attention:**

1. **`invoices.approveDiscount` is admin-only**, deliberately narrower than
   `applyDiscount`. A cashier proposing a discount and a manager authorising it
   should not be the same permission.
2. **`payroll.approve` is admin-only**; accountants build runs, admin signs them.
3. **Payroll and patient billing are separate modules** with separate grants, as
   you asked. But `accountant` currently holds both — the usual arrangement in a
   hospital this size. If you want true separation of duties, either drop
   `accountant` from `payroll` or add an `hr` role. **This is the decision most
   likely to differ from your intent.**
4. **`patients.overrideDuplicate` is receptionist-only** (plus admin). Doctors and
   nurses can register a patient but cannot force one past a duplicate warning.
5. **`labResults` and `radiologyResults` have no `edit`/`delete`** — results are
   corrected by `amend`, which appends and requires a reason.
6. `staff` (the baseline role) holds almost nothing: directory, own attendance,
   own payslip, inventory view and transact.

#### Client-side permissions

The server sends the user's effective grants with `/auth/login`, `/auth/refresh`
and `/auth/me`:

```json
{ "patients": ["view", "create", "edit"], "wards": ["view"] }
```

The client keeps **no copy of the matrix** — `client/src/app/permissions.js` holds
only module-name constants and lookup helpers. A duplicated client matrix drifts
from the server's, and the drift is invisible until someone sees a button that
403s. `useAuth().can(module, action)` drives route guards, nav filtering and
button visibility; the API re-checks every request regardless.

### Middleware chain

```
requireAuth                  → verifies JWT, loads active user, sets req.user
requirePermission(mod, act)  → 403 unless the matrix grants it; sets req.permission
validate(schema)             → zod-parses { body, params, query }; 422 on failure
audit({action, resourceType})→ hooks res.json, writes the trail after the response
<controller>
errorHandler                 → normalizes everything to { success:false, error:{...} }
```

Every route under `/api/v1` except `POST /auth/login`, `POST /auth/refresh` and
`POST /auth/logout` is wrapped in `requireAuth`, and every one declares an explicit
`requirePermission(...)`. There is no implicit "any authenticated user" access.

---

## 5. Conventions

### Audit logging on every medical and financial write

`middleware/audit.js`, mounted on every create / edit / delete route.

- Mounted **before** the controller: it wraps `res.json` to capture the response
  body, then writes the entry on the `finish` event, so the audit round-trip is
  never in the user's latency path.
- Controllers enrich the entry with `setAuditContext(req, { before, after,
  patientId, resourceRef, reason })`. Supplying `before` (a `toObject()` snapshot
  taken before mutation) produces a real field-level diff:
  `{"phone": {"from": "+234 802 555 0111", "to": "+234 802 555 0222"}}`.
- **Credentials are never written.** `password`, `passwordHash`, `token`,
  `refreshToken` and friends are redacted at any depth; a changed password is
  recorded as having changed, never as a value.
- Authentication events are logged directly via `recordAudit()`: `login`,
  `login_failed` (with the attempted address and reason — this is how credential
  stuffing shows up), `password_change`, `password_reset`.
- Only 2xx responses are recorded as `success`. Failures are recorded for
  `delete` and `override` actions, where a *rejected* attempt is itself
  interesting, and skipped otherwise to keep the collection signal-dense.
- **A failed audit write never fails the request.** It is logged to stderr
  instead. A nurse at the bedside should not get a 500 because the audit
  collection hiccuped. The trade-off — a small window where an action can succeed
  unlogged — is accepted deliberately; if your compliance regime forbids it,
  `recordAudit()` is the one function to change.

### Append-only clinical notes

Clinical notes (Phase 3) are never updated in place and never deleted. A
correction creates a **new** note document that links to the one it replaces:

```
note v1  { _id: A, version: 1, supersededBy: B, signedAt: ... }
note v2  { _id: B, version: 2, supersedes: A, amendmentReason: "Corrected...", ... }
```

Both remain readable; the chart shows the current version and offers the history.
This is why `clinicalNotes` has no `edit` or `delete` action in the matrix — the
permission simply does not exist, so no route can be wired to one. The same
pattern governs `labResults` and `radiologyResults` (`amend`, with a mandatory
reason, after verification).

### Soft deletes only

No route ever calls `deleteOne`/`deleteMany` on a business collection. Deletion sets:

```js
{ isActive: false, deletedAt: new Date(), deletedBy: req.user._id }
```

- Every schema carries `isActive` (default `true`, indexed), `deletedAt`, `deletedBy`.
- All list/read queries scope to `{ isActive: true }` unless an admin explicitly
  passes `?includeInactive=true`.
- `DELETE /:id` soft-deletes; `PATCH /:id/restore` reverses it.
- Rationale: medical and financial records are subject to retention requirements
  and must remain reconstructable for audit.
- **`auditLogs` is the one collection with no soft delete** — it has no delete at all.

### Audit fields on all medical and financial records

```js
createdBy: { type: ObjectId, ref: 'User' }
updatedBy: { type: ObjectId, ref: 'User' }
createdAt, updatedAt   // via { timestamps: true }
```

Applied by the `auditable` plugin. `createdBy`/`updatedBy` are set by the
controller from `req.user._id`, **never from the request body** — the client
cannot spoof authorship. Reference collections (`departments`, `wards`, `beds`)
carry them too, for configuration-change traceability.

### Naming

- **camelCase everywhere** — schema fields, JSON request/response bodies, JS
  variables. No snake_case in payloads.
- **Collection names**: lowercase plural, camelCase when multi-word (`labOrders`,
  not `lab_orders`).
- **Foreign keys**: `<singularEntity>Id` (`patientId`, `encounterId`,
  `attendingDoctorId`). Arrays of refs: `<singularEntity>Ids`.
- **Booleans**: `is*` / `has*` (`isActive`, `hasCriticalValues`).
- **Dates**: `*At` for timestamps (`admittedAt`, `deletedAt`), `*On`/`*Date` for
  calendar dates (`diagnosedOn`, `dateOfBirth`, `expiryDate`).
- **Enums**: lowercase strings, hyphenated where they read as one word
  (`semi-private`, `partially-paid`). Roles are the one snake_case exception
  (`lab_tech`).
- **Human-readable IDs**: uppercase prefix + zero-padded sequence — `MRN-000001`,
  `ENC-000001`, `EMP-00001`, `LAB-000001`, `INV-000001`. Generated atomically via
  the `counters` collection.

### API shape

- Base path `/api/v1`.
- Success: `{ success: true, message?, data, meta? }`
- Error: `{ success: false, error: { code, message, details? } }`. Stack traces
  are logged server-side and included in the response **only** when
  `NODE_ENV !== 'production'`.
- Lists are paginated: `?page=1&limit=20&sort=-createdAt&search=` →
  `meta: { page, limit, total, totalPages, hasNextPage, hasPrevPage }`.
- Status codes: 200 ok, 201 created, 400 bad request, 401 unauthenticated,
  403 forbidden, 404 not found, 409 conflict, 422 validation failed, 500 internal.

### Validation

All input is validated with **zod** at the route boundary via `validate(schema)`.
Schemas live beside their module in `<module>.validation.js`. The parsed result
replaces `req.body`/`req.query`/`req.params`, so controllers receive coerced,
stripped data — unknown keys are dropped, which prevents mass-assignment.

### Generated documents & file storage

Generated patient documents are written under `UPLOADS_DIR` (default
`server/uploads/`):

```
uploads/
└── lab-reports/<patientId>/LAB-000001-<timestamp>.pdf
```

- **The uploads directory is never mounted with `express.static`.** These are
  patient records; serving them statically would make any URL-holder able to read
  them. Downloads go through an authenticated, permission-gated route that
  streams the file.
- The stored path is **relative**; `resolveUploadPath()` re-resolves it against
  the uploads root and refuses anything that escapes, so a tampered DB value
  cannot become a path-traversal read.
- Filenames embed a timestamp, so regenerating a report writes a new file rather
  than overwriting a previously issued one.

### Aggregation pipelines need explicit ObjectId casting

Mongoose casts query values for `find()`/`countDocuments()` but **not** inside
`aggregate()`. A `$match` on a string `patientId` silently matches nothing.
Always wrap ids with `new Types.ObjectId(...)` when building a pipeline.
