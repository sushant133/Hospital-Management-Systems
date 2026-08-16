/**
 * Idempotent seed script — safe to run repeatedly.
 *
 *   npm run seed
 *
 * Creates the initial admin account plus a small set of departments, wards and
 * beds so the UI has something to show on first run. Existing records are left
 * untouched.
 */
import mongoose from 'mongoose';
import config, { ROLES } from '../src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { applyTransaction } from '../src/services/inventoryService.js';
import { NEPAL_SCHEMES } from '../src/data/nepalSchemes.js';
import {
  User,
  Department,
  Ward,
  Bed,
  LabTest,
  RadiologyExam,
  DoctorAvailability,
  Drug,
  DrugBatch,
  InventoryItem,
  InsuranceProvider,
  SalaryStructure,
  BillingPackage,
  Facility,
  Supplier,
  DrugInteraction,
  Scheme,
  Device,
  BloodUnit,
} from '../src/models/index.js';

const DEPARTMENTS = [
  { code: 'GEN', name: 'General Medicine', description: 'Primary internal medicine and outpatient care', floor: '1' },
  { code: 'SURG', name: 'Surgery', description: 'General and specialist surgical services', floor: '2' },
  { code: 'PED', name: 'Paediatrics', description: 'Care for infants, children and adolescents', floor: '1' },
  { code: 'OBG', name: 'Obstetrics & Gynaecology', description: 'Maternity and women’s health', floor: '3' },
  { code: 'EMER', name: 'Emergency', description: 'Round-the-clock emergency and trauma care', floor: 'G' },
  { code: 'ICU', name: 'Critical Care', description: 'Intensive and high-dependency care', floor: '4' },
  { code: 'RAD', name: 'Radiology', description: 'Diagnostic imaging — X-ray, CT, MRI and ultrasound', floor: 'G' },
  { code: 'PHA', name: 'Pharmacy', description: 'Dispensary, drug stores and clinical pharmacy', floor: 'G' },
  { code: 'FIN', name: 'Finance & Billing', description: 'Invoicing, insurance claims and payroll', floor: '1' },
];

const WARDS = [
  { code: 'GW-A', name: 'General Ward A', departmentCode: 'GEN', type: 'general', gender: 'male', floor: '1', beds: 12 },
  { code: 'GW-B', name: 'General Ward B', departmentCode: 'GEN', type: 'general', gender: 'female', floor: '1', beds: 12 },
  { code: 'SW-1', name: 'Surgical Ward', departmentCode: 'SURG', type: 'semi-private', gender: 'mixed', floor: '2', beds: 8 },
  { code: 'PW-1', name: 'Paediatric Ward', departmentCode: 'PED', type: 'general', gender: 'mixed', floor: '1', beds: 10 },
  { code: 'MAT-1', name: 'Maternity Ward', departmentCode: 'OBG', type: 'maternity', gender: 'female', floor: '3', beds: 8 },
  { code: 'ICU-1', name: 'Intensive Care Unit', departmentCode: 'ICU', type: 'icu', gender: 'mixed', floor: '4', beds: 6 },
];

/**
 * A minimal clinical team. Without at least one doctor there is nobody to book
 * an appointment with, so scheduling cannot be exercised on a fresh install.
 *
 * These are DEMONSTRATION accounts sharing one well-known password. Delete them
 * (or change the passwords) before the system sees real patients — the
 * production checklist in README.md says so too.
 */
const DEMO_PASSWORD = 'Passw0rd!';

const STAFF = [
  {
    email: 'doctor@hospital.local',
    firstName: 'Amara',
    lastName: 'Okafor',
    role: ROLES.DOCTOR,
    departmentCode: 'GEN',
    specialization: 'Internal Medicine',
  },
  {
    email: 'surgeon@hospital.local',
    firstName: 'Ravi',
    lastName: 'Menon',
    role: ROLES.DOCTOR,
    departmentCode: 'SURG',
    specialization: 'General Surgery',
  },
  {
    email: 'reception@hospital.local',
    firstName: 'Grace',
    lastName: 'Hopper',
    role: ROLES.RECEPTIONIST,
    departmentCode: 'GEN',
  },
  {
    email: 'nurse@hospital.local',
    firstName: 'Mary',
    lastName: 'Seacole',
    role: ROLES.NURSE,
    departmentCode: 'GEN',
  },
  {
    email: 'radiologist@hospital.local',
    firstName: 'Elena',
    lastName: 'Vasquez',
    role: ROLES.RADIOLOGIST,
    departmentCode: 'RAD',
    specialization: 'Diagnostic Radiology',
    licenseNumber: 'RAD-1001',
  },
  {
    email: 'pharmacist@hospital.local',
    firstName: 'Paul',
    lastName: 'Ehrlich',
    role: ROLES.PHARMACIST,
    departmentCode: 'PHA',
    licenseNumber: 'PHA-1001',
  },
  {
    // Without an accountant, invoicing, insurance claims and payroll can only be
    // reached as the admin — three whole modules unexercisable on a fresh install.
    email: 'accountant@hospital.local',
    firstName: 'Luca',
    lastName: 'Pacioli',
    role: ROLES.ACCOUNTANT,
    departmentCode: 'FIN',
  },
];

/**
 * Weekly clinic windows for the demo doctors. Every bookable slot is generated
 * from these, so the appointment book is empty until they exist.
 */
const AVAILABILITY = [
  { email: 'doctor@hospital.local', days: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '13:00', slotMinutes: 15 },
  { email: 'doctor@hospital.local', days: [1, 3, 5], startTime: '14:00', endTime: '17:00', slotMinutes: 15 },
  { email: 'surgeon@hospital.local', days: [2, 4], startTime: '10:00', endTime: '13:00', slotMinutes: 30 },
];

/**
 * Starter lab catalogue. Reference ranges are typical adult values — a real
 * deployment must have these signed off by the laboratory director.
 */
const LAB_TESTS = [
  {
    code: 'FBC',
    name: 'Full Blood Count',
    category: 'Haematology',
    departmentCode: 'GEN',
    specimen: 'blood',
    price: 25,
    turnaroundHours: 4,
    analytes: [
      { code: 'HGB', name: 'Haemoglobin', unit: 'g/dL', refLow: 13, refHigh: 17, criticalLow: 7, criticalHigh: 20, displayOrder: 1 },
      { code: 'WBC', name: 'White Cell Count', unit: '10^9/L', refLow: 4, refHigh: 11, criticalLow: 1, criticalHigh: 30, displayOrder: 2 },
      { code: 'PLT', name: 'Platelet Count', unit: '10^9/L', refLow: 150, refHigh: 400, criticalLow: 50, criticalHigh: 1000, displayOrder: 3 },
      { code: 'HCT', name: 'Haematocrit', unit: '%', refLow: 40, refHigh: 52, displayOrder: 4 },
      { code: 'MCV', name: 'Mean Cell Volume', unit: 'fL', refLow: 80, refHigh: 100, displayOrder: 5 },
    ],
  },
  {
    code: 'BMP',
    name: 'Basic Metabolic Panel',
    category: 'Biochemistry',
    departmentCode: 'GEN',
    specimen: 'serum',
    price: 35,
    turnaroundHours: 6,
    analytes: [
      { code: 'NA', name: 'Sodium', unit: 'mmol/L', refLow: 135, refHigh: 145, criticalLow: 120, criticalHigh: 160, displayOrder: 1 },
      { code: 'K', name: 'Potassium', unit: 'mmol/L', refLow: 3.5, refHigh: 5.1, criticalLow: 2.5, criticalHigh: 6.5, displayOrder: 2 },
      { code: 'CL', name: 'Chloride', unit: 'mmol/L', refLow: 98, refHigh: 107, displayOrder: 3 },
      { code: 'UREA', name: 'Urea', unit: 'mmol/L', refLow: 2.5, refHigh: 7.8, displayOrder: 4 },
      { code: 'CREA', name: 'Creatinine', unit: 'umol/L', refLow: 60, refHigh: 110, criticalHigh: 400, displayOrder: 5 },
      { code: 'GLU', name: 'Glucose (random)', unit: 'mmol/L', refLow: 3.9, refHigh: 7.8, criticalLow: 2.2, criticalHigh: 25, displayOrder: 6 },
    ],
  },
  {
    code: 'LFT',
    name: 'Liver Function Tests',
    category: 'Biochemistry',
    departmentCode: 'GEN',
    specimen: 'serum',
    price: 40,
    turnaroundHours: 8,
    analytes: [
      { code: 'ALT', name: 'Alanine Aminotransferase', unit: 'U/L', refLow: 7, refHigh: 56, displayOrder: 1 },
      { code: 'AST', name: 'Aspartate Aminotransferase', unit: 'U/L', refLow: 10, refHigh: 40, displayOrder: 2 },
      { code: 'ALP', name: 'Alkaline Phosphatase', unit: 'U/L', refLow: 44, refHigh: 147, displayOrder: 3 },
      { code: 'TBIL', name: 'Total Bilirubin', unit: 'umol/L', refLow: 3, refHigh: 20, displayOrder: 4 },
      { code: 'ALB', name: 'Albumin', unit: 'g/L', refLow: 35, refHigh: 50, displayOrder: 5 },
    ],
  },
  {
    code: 'URIN',
    name: 'Urinalysis',
    category: 'Clinical Pathology',
    departmentCode: 'GEN',
    specimen: 'urine',
    price: 15,
    turnaroundHours: 2,
    analytes: [
      { code: 'UPROT', name: 'Protein', valueType: 'text', expectedValues: ['negative', 'trace', '1+', '2+', '3+'], normalValue: 'negative', displayOrder: 1 },
      { code: 'UGLU', name: 'Glucose', valueType: 'text', expectedValues: ['negative', 'trace', '1+', '2+', '3+'], normalValue: 'negative', displayOrder: 2 },
      { code: 'UBLD', name: 'Blood', valueType: 'text', expectedValues: ['negative', 'trace', '1+', '2+', '3+'], normalValue: 'negative', displayOrder: 3 },
      { code: 'UPH', name: 'pH', unit: '', refLow: 4.5, refHigh: 8, displayOrder: 4 },
    ],
  },
  {
    code: 'MP',
    name: 'Malaria Parasite Screen',
    category: 'Microbiology',
    departmentCode: 'GEN',
    specimen: 'blood',
    price: 12,
    turnaroundHours: 2,
    analytes: [
      { code: 'MPS', name: 'Malaria Parasites', valueType: 'text', expectedValues: ['negative', 'positive'], normalValue: 'negative', displayOrder: 1 },
    ],
  },
  {
    code: 'TFT',
    name: 'Thyroid Function Tests',
    category: 'Endocrinology',
    departmentCode: 'GEN',
    specimen: 'serum',
    price: 45,
    turnaroundHours: 24,
    analytes: [
      { code: 'TSH', name: 'Thyroid Stimulating Hormone', unit: 'mIU/L', refLow: 0.4, refHigh: 4, displayOrder: 1 },
      { code: 'FT4', name: 'Free T4', unit: 'pmol/L', refLow: 9, refHigh: 25, displayOrder: 2 },
    ],
  },
  {
    code: 'CARD',
    name: 'Cardiac Enzymes',
    category: 'Biochemistry',
    departmentCode: 'EMER',
    specimen: 'serum',
    price: 60,
    turnaroundHours: 1,
    analytes: [
      { code: 'TROP', name: 'Troponin I', unit: 'ng/mL', refLow: 0, refHigh: 0.04, criticalHigh: 0.5, displayOrder: 1 },
      { code: 'CKMB', name: 'CK-MB', unit: 'ng/mL', refLow: 0, refHigh: 5, displayOrder: 2 },
    ],
  },
];

/**
 * Starter imaging catalogue. Prices and typical doses are illustrative —
 * a real deployment must have these signed off by the radiology director.
 */
const RADIOLOGY_EXAMS = [
  {
    code: 'CXR',
    name: 'Chest X-ray PA and lateral',
    modality: 'xray',
    bodyPart: 'Chest',
    departmentCode: 'RAD',
    price: 40,
    durationMinutes: 10,
    typicalDoseMsv: 0.1,
  },
  {
    code: 'AXR',
    name: 'Abdominal X-ray',
    modality: 'xray',
    bodyPart: 'Abdomen',
    departmentCode: 'RAD',
    price: 35,
    durationMinutes: 10,
    typicalDoseMsv: 0.7,
  },
  {
    code: 'CTHEAD',
    name: 'CT Head without contrast',
    modality: 'ct',
    bodyPart: 'Head',
    departmentCode: 'RAD',
    price: 180,
    durationMinutes: 15,
    typicalDoseMsv: 2,
    preparationNotes: 'Remove metal objects. No contrast.',
  },
  {
    code: 'CTHEADC',
    name: 'CT Head with contrast',
    modality: 'ct',
    bodyPart: 'Head',
    departmentCode: 'RAD',
    price: 240,
    durationMinutes: 20,
    typicalDoseMsv: 2.1,
    contrastRequired: true,
    preparationNotes: 'Check renal function and contrast allergy history.',
  },
  {
    code: 'USSABD',
    name: 'Ultrasound abdomen',
    modality: 'ultrasound',
    bodyPart: 'Abdomen',
    departmentCode: 'RAD',
    price: 80,
    durationMinutes: 20,
    typicalDoseMsv: 0,
    preparationNotes: 'Fast for 6 hours if gallbladder is the indication.',
  },
  {
    code: 'MRIKNEE',
    name: 'MRI Knee',
    modality: 'mri',
    bodyPart: 'Knee',
    departmentCode: 'RAD',
    price: 350,
    durationMinutes: 40,
    typicalDoseMsv: 0,
    preparationNotes: 'MRI safety questionnaire. Remove all metal.',
  },
  {
    code: 'MAMMO',
    name: 'Mammography bilateral',
    modality: 'mammography',
    bodyPart: 'Breast',
    departmentCode: 'RAD',
    price: 90,
    durationMinutes: 20,
    typicalDoseMsv: 0.4,
  },
];

async function seedLabTests(admin, departmentsByCode) {
  for (const spec of LAB_TESTS) {
    const existing = await LabTest.findOne({ code: spec.code });
    if (existing) continue;

    const department = departmentsByCode.get(spec.departmentCode) ?? departmentsByCode.get('GEN');
    if (!department) continue;

    const { departmentCode, ...rest } = spec;
    await LabTest.create({
      ...rest,
      departmentId: department._id,
      createdBy: admin._id,
      updatedBy: admin._id,
    });
    console.log(`[seed] created lab test ${spec.code} — ${spec.name}`);
  }
}

/**
 * Starter formulary. `allergenClasses` is the field that makes the allergy
 * check work: a patient allergic to "penicillin" must be warned about
 * amoxicillin, whose name shares nothing with it.
 */
const DRUGS = [
  {
    drugCode: 'AMOX-500', name: 'Amoxil', genericName: 'Amoxicillin', form: 'capsule',
    strength: '500 mg', unit: 'capsule', defaultRoute: 'oral', sellingPrice: 2,
    reorderLevel: 100, allergenClasses: ['penicillin', 'beta-lactam'],
    cautions: 'Check penicillin allergy before dispensing.',
    batches: [
      // Long-dated stock received first…
      { batchNo: 'AMX-2401', expiresInDays: 540, quantity: 400, costPrice: 1.1 },
      // …then a short-dated box. FEFO must reach for THIS one.
      { batchNo: 'AMX-2402', expiresInDays: 45, quantity: 60, costPrice: 1.1 },
    ],
  },
  {
    drugCode: 'PARA-500', name: 'Panadol', genericName: 'Paracetamol', form: 'tablet',
    strength: '500 mg', unit: 'tablet', defaultRoute: 'oral', sellingPrice: 1,
    reorderLevel: 200,
    batches: [{ batchNo: 'PAR-2401', expiresInDays: 400, quantity: 1000, costPrice: 0.4 }],
  },
  {
    drugCode: 'IBU-400', name: 'Brufen', genericName: 'Ibuprofen', form: 'tablet',
    strength: '400 mg', unit: 'tablet', defaultRoute: 'oral', sellingPrice: 1.5,
    reorderLevel: 150, allergenClasses: ['nsaid', 'ibuprofen'],
    cautions: 'Avoid in peptic ulcer disease and severe renal impairment.',
    batches: [{ batchNo: 'IBU-2401', expiresInDays: 300, quantity: 500, costPrice: 0.6 }],
  },
  {
    drugCode: 'CEFT-1G', name: 'Rocephin', genericName: 'Ceftriaxone', form: 'injection',
    strength: '1 g', unit: 'vial', defaultRoute: 'iv', sellingPrice: 12,
    reorderLevel: 40, allergenClasses: ['cephalosporin', 'beta-lactam'],
    cautions: 'Cross-reactivity with penicillin allergy is possible.',
    batches: [{ batchNo: 'CEF-2401', expiresInDays: 210, quantity: 120, costPrice: 7 }],
  },
  {
    drugCode: 'MORPH-10', name: 'Morphine sulfate', genericName: 'Morphine', form: 'injection',
    strength: '10 mg/ml', unit: 'ampoule', defaultRoute: 'iv', sellingPrice: 8,
    reorderLevel: 20, isControlled: true,
    cautions: 'Controlled drug — record in the CD register.',
    batches: [{ batchNo: 'MOR-2401', expiresInDays: 250, quantity: 50, costPrice: 4 }],
  },
  {
    drugCode: 'ORS-1', name: 'Oral rehydration salts', genericName: 'Oral rehydration salts',
    form: 'other', strength: '20.5 g', unit: 'sachet', defaultRoute: 'oral', sellingPrice: 0.5,
    reorderLevel: 300,
    batches: [{ batchNo: 'ORS-2401', expiresInDays: 600, quantity: 800, costPrice: 0.2 }],
  },
];

/**
 * Starter general store. One item is seeded deliberately below its reorder
 * level so the alerts view has something to show on a fresh install.
 */
const INVENTORY_ITEMS = [
  { itemCode: 'GLV-M', name: 'Nitrile gloves, medium', category: 'ppe', unit: 'box', reorderLevel: 20, unitCost: 5, location: 'Central store', openingStock: 120 },
  { itemCode: 'GLV-L', name: 'Nitrile gloves, large', category: 'ppe', unit: 'box', reorderLevel: 20, unitCost: 5, location: 'Central store', openingStock: 80 },
  { itemCode: 'MSK-N95', name: 'N95 respirator', category: 'ppe', unit: 'box', reorderLevel: 15, unitCost: 22, location: 'Central store', openingStock: 40 },
  { itemCode: 'SYR-5ML', name: 'Syringe 5 ml', category: 'consumable', unit: 'box', reorderLevel: 30, unitCost: 8, location: 'Central store', openingStock: 150 },
  { itemCode: 'GAU-10', name: 'Gauze swabs 10x10cm', category: 'surgical', unit: 'pack', reorderLevel: 40, unitCost: 3, location: 'Theatre store', openingStock: 200 },
  { itemCode: 'IVC-20G', name: 'IV cannula 20G', category: 'consumable', unit: 'box', reorderLevel: 25, unitCost: 14, location: 'Central store', openingStock: 60 },
  // Deliberately short, so the reorder alert has something to report.
  { itemCode: 'BED-SHT', name: 'Bed sheets', category: 'linen', unit: 'piece', reorderLevel: 100, unitCost: 6, location: 'Laundry', openingStock: 45 },
  { itemCode: 'WHC-1', name: 'Wheelchair', category: 'equipment', unit: 'unit', reorderLevel: 2, unitCost: 300, location: 'Porter bay', isAsset: true, openingStock: 6 },
  { itemCode: 'DRP-STD', name: 'IV drip stand', category: 'equipment', unit: 'unit', reorderLevel: 5, unitCost: 45, location: 'Central store', isAsset: true, openingStock: 25 },
];

async function seedRadiologyExams(admin, departmentsByCode) {
  for (const spec of RADIOLOGY_EXAMS) {
    const existing = await RadiologyExam.findOne({ code: spec.code });
    if (existing) continue;

    const department = departmentsByCode.get(spec.departmentCode) ?? departmentsByCode.get('RAD');
    if (!department) continue;

    const { departmentCode, ...rest } = spec;
    await RadiologyExam.create({
      ...rest,
      departmentId: department._id,
      createdBy: admin._id,
      updatedBy: admin._id,
    });
    console.log(`[seed] created radiology exam ${spec.code} — ${spec.name}`);
  }
}

/**
 * A starter formulary with stock.
 *
 * Two batches of amoxicillin are seeded with **different expiry dates and the
 * short-dated one received second**, so FEFO dispensing is demonstrable on a
 * fresh install: a FIFO system would reach for the wrong box.
 */
async function seedPharmacy(admin) {
  const created = [];

  for (const spec of DRUGS) {
    let drug = await Drug.findOne({ drugCode: spec.drugCode });
    if (!drug) {
      const { batches, ...rest } = spec;
      drug = await Drug.create({ ...rest, createdBy: admin._id, updatedBy: admin._id });
      created.push(drug.drugCode);
    }

    for (const batch of spec.batches ?? []) {
      const exists = await DrugBatch.findOne({ drugId: drug._id, batchNo: batch.batchNo });
      if (exists) continue;

      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + batch.expiresInDays);

      await DrugBatch.create({
        drugId: drug._id,
        batchNo: batch.batchNo,
        expiryDate,
        quantityReceived: batch.quantity,
        quantityOnHand: batch.quantity,
        costPrice: batch.costPrice ?? 0,
        supplier: batch.supplier ?? 'Demo Supplies Ltd',
        status: 'active',
        createdBy: admin._id,
        updatedBy: admin._id,
      });
    }
  }

  if (created.length) {
    console.log(`[seed] created ${created.length} formulary entries with stock: ${created.join(', ')}`);
  }
}

/**
 * A starter store, with opening stock brought in through the ledger rather than
 * written straight onto the item — the same path the UI uses, so the balances
 * and the ledger agree from the first run.
 */
async function seedInventory(admin) {
  const created = [];

  for (const spec of INVENTORY_ITEMS) {
    let item = await InventoryItem.findOne({ itemCode: spec.itemCode });
    if (item) continue;

    const { openingStock, ...rest } = spec;
    item = await InventoryItem.create({
      ...rest,
      quantityOnHand: 0,
      createdBy: admin._id,
      updatedBy: admin._id,
    });

    if (openingStock > 0) {
      await applyTransaction({
        itemId: item._id,
        type: 'receipt',
        quantity: openingStock,
        reference: 'Opening stock',
        user: admin,
      });
    }

    created.push(item.itemCode);
  }

  if (created.length) {
    console.log(`[seed] created ${created.length} store items with opening stock: ${created.join(', ')}`);
  }
}

/**
 * Starter insurers. Exclusions are what makes the claim builder interesting:
 * a charge matching one is dropped from the claim rather than silently sent.
 */
const INSURERS = [
  {
    code: 'ACME', name: 'Acme Health Cover', kind: 'insurer', contactPerson: 'Claims Desk',
    phone: '+1 555 010 2000', claimSubmissionEmail: 'claims@acme.example',
    defaultCoPayPercent: 20, settlementDays: 45,
    exclusions: ['cosmetic', 'dental'],
  },
  {
    code: 'NHIS', name: 'National Health Insurance Scheme', kind: 'insurer',
    phone: '+1 555 010 3000', claimSubmissionEmail: 'claims@nhis.example',
    defaultCoPayPercent: 10, settlementDays: 60,
    exclusions: ['cosmetic'],
  },
  {
    code: 'CORP', name: 'Corporate Staff Plan', kind: 'insurer', contactPerson: 'HR Benefits',
    defaultCoPayPercent: 0, settlementDays: 30,
  },
  {
    code: 'MEDASSIST', name: 'MedAssist TPA', kind: 'tpa', contactPerson: 'Cashless Desk',
    phone: '+1 555 010 4000', claimSubmissionEmail: 'cashless@medassist.example',
    defaultCoPayPercent: 10, settlementDays: 21,
    exclusions: ['cosmetic'],
  },
];

async function seedInsurers(admin) {
  const created = [];
  for (const spec of INSURERS) {
    const existing = await InsuranceProvider.findOne({ code: spec.code });
    if (existing) continue;
    await InsuranceProvider.create({ ...spec, createdBy: admin._id, updatedBy: admin._id });
    created.push(spec.code);
  }
  if (created.length) {
    console.log(`[seed] created ${created.length} insurers: ${created.join(', ')}`);
  }
}

const PACKAGES = [
  {
    code: 'OPD-CONSULT',
    name: 'OPD consultation pack',
    description: 'First-visit consultation with basic investigations.',
    departmentCode: 'GEN',
    items: [
      { itemCode: 'CONSULT', description: 'Physician consultation', quantity: 1, unitPrice: 800, taxPercent: 0, sourceType: 'consultation' },
      { itemCode: 'CBC', description: 'Complete blood count', quantity: 1, unitPrice: 350, taxPercent: 5, sourceType: 'lab' },
    ],
  },
  {
    code: 'OT-HERNIA',
    name: 'Hernia repair package',
    description: 'Elective inguinal hernia — OT, anaesthesia, one night stay.',
    departmentCode: 'SURG',
    items: [
      { itemCode: 'OT-HERNIA', description: 'Hernia repair (OT)', quantity: 1, unitPrice: 18000, taxPercent: 5, sourceType: 'procedure' },
      { itemCode: 'ANAES-GA', description: 'General anaesthesia', quantity: 1, unitPrice: 4500, taxPercent: 5, sourceType: 'procedure' },
      { itemCode: 'BED-1N', description: 'General ward night', quantity: 1, unitPrice: 2500, taxPercent: 0, sourceType: 'other' },
    ],
  },
];

async function seedPackages(admin, departments) {
  const created = [];
  for (const spec of PACKAGES) {
    const existing = await BillingPackage.findOne({ code: spec.code });
    if (existing) continue;
    const department = departments.get(spec.departmentCode);
    await BillingPackage.create({
      code: spec.code,
      name: spec.name,
      description: spec.description,
      departmentId: department?._id ?? null,
      items: spec.items,
      createdBy: admin._id,
      updatedBy: admin._id,
    });
    created.push(spec.code);
  }
  if (created.length) {
    console.log(`[seed] created ${created.length} billing packages: ${created.join(', ')}`);
  }
}

async function seedAdmin() {
  const existing = await User.findOne({ email: config.seed.adminEmail });
  if (existing) {
    console.log(`[seed] admin already exists: ${existing.email}`);
    return existing;
  }

  const admin = await User.create({
    email: config.seed.adminEmail,
    passwordHash: await User.hashPassword(config.seed.adminPassword),
    firstName: config.seed.adminFirstName,
    lastName: config.seed.adminLastName,
    role: ROLES.ADMIN,
    mustChangePassword: true,
  });

  // The admin is its own creator — nothing else exists yet.
  admin.createdBy = admin._id;
  admin.updatedBy = admin._id;
  await admin.save();

  console.log(`[seed] created admin: ${admin.email}`);
  return admin;
}

async function seedDepartments(admin) {
  const byCode = new Map();

  for (const spec of DEPARTMENTS) {
    let department = await Department.findOne({ code: spec.code });
    if (!department) {
      department = await Department.create({
        ...spec,
        createdBy: admin._id,
        updatedBy: admin._id,
      });
      console.log(`[seed] created department ${department.code} — ${department.name}`);
    }
    byCode.set(spec.code, department);
  }

  return byCode;
}

async function seedWards(admin, departmentsByCode) {
  for (const spec of WARDS) {
    const department = departmentsByCode.get(spec.departmentCode);
    if (!department) continue;

    let ward = await Ward.findOne({ code: spec.code });
    if (!ward) {
      ward = await Ward.create({
        code: spec.code,
        name: spec.name,
        departmentId: department._id,
        type: spec.type,
        gender: spec.gender,
        floor: spec.floor,
        totalBeds: 0,
        createdBy: admin._id,
        updatedBy: admin._id,
      });
      console.log(`[seed] created ward ${ward.code} — ${ward.name}`);
    }

    const existingBeds = await Bed.countDocuments({ wardId: ward._id });
    if (existingBeds === 0) {
      const prefix = `${spec.code}-`;
      const beds = Array.from({ length: spec.beds }, (_, i) => ({
        bedNumber: `${prefix}${String(i + 1).padStart(2, '0')}`,
        wardId: ward._id,
        status: 'available',
        dailyRate: spec.type === 'icu' ? 500 : spec.type === 'semi-private' ? 200 : 100,
        createdBy: admin._id,
        updatedBy: admin._id,
      }));
      await Bed.insertMany(beds);
      console.log(`[seed]   + ${beds.length} beds`);
    }

    ward.totalBeds = await Bed.countDocuments({ wardId: ward._id, isActive: true });
    await ward.save();
  }
}

/** Demo clinical staff — skipped for any email that already exists. */
async function seedStaff(admin, departmentsByCode) {
  const byEmail = new Map();

  for (const spec of STAFF) {
    let user = await User.findOne({ email: spec.email });

    if (!user) {
      const { departmentCode, ...rest } = spec;
      user = await User.create({
        ...rest,
        passwordHash: await User.hashPassword(DEMO_PASSWORD),
        departmentId: departmentsByCode.get(departmentCode)?._id ?? null,
        mustChangePassword: true,
        createdBy: admin._id,
        updatedBy: admin._id,
      });
      console.log(`[seed] created ${spec.role}: ${user.email}`);
    }

    byEmail.set(spec.email, user);
  }

  return byEmail;
}

/** Weekly clinic windows for the demo doctors. */
async function seedAvailability(admin, staffByEmail) {
  for (const spec of AVAILABILITY) {
    const doctor = staffByEmail.get(spec.email);
    if (!doctor) continue;

    let created = 0;

    for (const dayOfWeek of spec.days) {
      const existing = await DoctorAvailability.findOne({
        doctorId: doctor._id,
        dayOfWeek,
        startTime: spec.startTime,
      });
      if (existing) continue;

      await DoctorAvailability.create({
        doctorId: doctor._id,
        departmentId: doctor.departmentId,
        dayOfWeek,
        startTime: spec.startTime,
        endTime: spec.endTime,
        slotMinutes: spec.slotMinutes,
        createdBy: admin._id,
        updatedBy: admin._id,
      });
      created += 1;
    }

    if (created > 0) {
      console.log(
        `[seed] clinic for ${spec.email}: ${spec.startTime}–${spec.endTime} on ${created} day(s)`,
      );
    }
  }
}

/**
 * Starter pay for the demo staff.
 *
 * A payroll run skips anyone without a structure in force, so without these a
 * fresh install produces an empty run and payroll looks broken rather than
 * unconfigured. Figures are illustrative — set real ones before going live.
 */
const SALARIES = [
  { email: 'doctor@hospital.local', basicSalary: 90000, housing: 15000 },
  { email: 'surgeon@hospital.local', basicSalary: 110000, housing: 18000 },
  { email: 'radiologist@hospital.local', basicSalary: 95000, housing: 15000 },
  { email: 'pharmacist@hospital.local', basicSalary: 55000, housing: 9000 },
  { email: 'nurse@hospital.local', basicSalary: 42000, housing: 7000 },
  { email: 'reception@hospital.local', basicSalary: 28000, housing: 5000 },
  { email: 'accountant@hospital.local', basicSalary: 48000, housing: 8000 },
];

async function seedSalaries(admin, staffByEmail) {
  let created = 0;

  for (const spec of SALARIES) {
    const user = staffByEmail.get(spec.email);
    if (!user) continue;

    // Structures are effective-dated and never edited in place, so an existing
    // one is left alone — re-seeding must not silently supersede real pay.
    const existing = await SalaryStructure.findOne({ userId: user._id });
    if (existing) continue;

    // From the start of the current year, so the first run of any month in this
    // year finds a structure in force.
    const effectiveFrom = new Date(new Date().getFullYear(), 0, 1);

    await SalaryStructure.create({
      userId: user._id,
      basicSalary: spec.basicSalary,
      allowances: [
        { label: 'Housing', amount: spec.housing },
        { label: 'Transport', percentOfBasic: 10 },
      ],
      deductions: [{ label: 'Pension', percentOfBasic: 8 }],
      effectiveFrom,
      notes: 'Seeded demonstration figure — replace before going live.',
      createdBy: admin._id,
      updatedBy: admin._id,
    });
    created += 1;
  }

  if (created > 0) console.log(`[seed] created ${created} salary structures`);
}

async function seedTier23(admin) {
  if (!(await Facility.findOne({ code: 'MAIN' }))) {
    await Facility.create({
      code: 'MAIN',
      name: 'General Hospital — Main campus',
      kind: 'hospital',
      isDefault: true,
      createdBy: admin._id,
      updatedBy: admin._id,
    });
    console.log('[seed] created facility MAIN');
  }

  const suppliers = [
    { code: 'MEDSUP', name: 'MedSupply Co', kind: 'drug', phone: '+1 555 010 5000' },
    { code: 'GENSTORE', name: 'Hospital Stores Ltd', kind: 'general' },
  ];
  for (const spec of suppliers) {
    if (await Supplier.findOne({ code: spec.code })) continue;
    await Supplier.create({ ...spec, createdBy: admin._id, updatedBy: admin._id });
    console.log(`[seed] created supplier ${spec.code}`);
  }

  const pairs = [
    { genericA: 'warfarin', genericB: 'ibuprofen', severity: 'severe', description: 'NSAIDs increase bleeding risk with warfarin.' },
    { genericA: 'metformin', genericB: 'contrast', severity: 'moderate', description: 'Hold metformin around iodinated contrast.' },
  ];
  for (const spec of pairs) {
    if (await DrugInteraction.findOne({ genericA: spec.genericA, genericB: spec.genericB })) continue;
    await DrugInteraction.create({ ...spec, createdBy: admin._id, updatedBy: admin._id });
    console.log(`[seed] interaction ${spec.genericA}+${spec.genericB}`);
  }

  if (!(await Device.findOne({ code: 'ANALYZER-1' }))) {
    await Device.create({
      code: 'ANALYZER-1',
      name: 'Demo chemistry analyzer',
      kind: 'analyzer',
      sendingApplication: 'ANALYZER',
      location: 'Main lab',
      createdBy: admin._id,
      updatedBy: admin._id,
    });
    console.log('[seed] created device ANALYZER-1');
  }

  if (!(await BloodUnit.findOne({ bagNumber: 'BB-SEED1' }))) {
    const expires = new Date();
    expires.setDate(expires.getDate() + 35);
    await BloodUnit.create({
      bagNumber: 'BB-SEED1',
      group: 'O+',
      component: 'prbc',
      expiresAt: expires,
      donorRef: 'SEED',
      createdBy: admin._id,
      updatedBy: admin._id,
    });
    console.log('[seed] created blood unit BB-SEED1');
  }
}

/**
 * Nepal's government health schemes.
 *
 * Seeded as DATA rather than hardcoded, because every ceiling and incentive
 * here is set by the annual budget or an MoHP directive and will move. Existing
 * rows are left alone on re-run: once a hospital's accounts office has
 * corrected a figure against the operative circular, a later seed must not
 * quietly overwrite it.
 */
async function seedSchemes(admin) {
  let created = 0;
  for (const spec of NEPAL_SCHEMES) {
    if (await Scheme.findOne({ code: spec.code })) continue;
    await Scheme.create({ ...spec, createdBy: admin._id, updatedBy: admin._id });
    created += 1;
  }
  if (created > 0) {
    console.log(`[seed] created ${created} government schemes`);
    console.log('[seed] ⚠ VERIFY every ceiling and incentive against the current directive.');
  }
}

async function run() {
  await connectDatabase();

  const admin = await seedAdmin();
  const departments = await seedDepartments(admin);
  await seedWards(admin, departments);
  await seedLabTests(admin, departments);
  await seedRadiologyExams(admin, departments);
  await seedPharmacy(admin);
  await seedInventory(admin);
  await seedInsurers(admin);
  await seedSchemes(admin);
  await seedPackages(admin, departments);
  const staff = await seedStaff(admin, departments);
  await seedAvailability(admin, staff);
  await seedSalaries(admin, staff);
  await seedTier23(admin);

  console.log('\n[seed] done.');
  console.log('---------------------------------------------');
  console.log(`  Sign in with: ${config.seed.adminEmail}`);
  console.log(`  Password:     ${config.seed.adminPassword}`);
  console.log('  Change this password immediately.');
  console.log('');
  console.log('  Demo staff (all password: ' + DEMO_PASSWORD + ')');
  for (const spec of STAFF) console.log(`    ${spec.role.padEnd(13)} ${spec.email}`);
  console.log('  Remove these before going live.');
  console.log('---------------------------------------------\n');

  await disconnectDatabase();
  await mongoose.disconnect().catch(() => {});
  process.exit(0);
}

run().catch(async (error) => {
  console.error('[seed] failed:', error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
