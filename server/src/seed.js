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
import config, { ROLES } from './config/index.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { User, Department, Ward, Bed, LabTest } from './models/index.js';

const DEPARTMENTS = [
  { code: 'GEN', name: 'General Medicine', description: 'Primary internal medicine and outpatient care', floor: '1' },
  { code: 'SURG', name: 'Surgery', description: 'General and specialist surgical services', floor: '2' },
  { code: 'PED', name: 'Paediatrics', description: 'Care for infants, children and adolescents', floor: '1' },
  { code: 'OBG', name: 'Obstetrics & Gynaecology', description: 'Maternity and women’s health', floor: '3' },
  { code: 'EMER', name: 'Emergency', description: 'Round-the-clock emergency and trauma care', floor: 'G' },
  { code: 'ICU', name: 'Critical Care', description: 'Intensive and high-dependency care', floor: '4' },
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

async function run() {
  await connectDatabase();

  const admin = await seedAdmin();
  const departments = await seedDepartments(admin);
  await seedWards(admin, departments);
  await seedLabTests(admin, departments);

  console.log('\n[seed] done.');
  console.log('---------------------------------------------');
  console.log(`  Sign in with: ${config.seed.adminEmail}`);
  console.log(`  Password:     ${config.seed.adminPassword}`);
  console.log('  Change this password immediately.');
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
