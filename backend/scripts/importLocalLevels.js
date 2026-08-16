/**
 * ============================================================================
 * IMPORT NEPAL'S 753 LOCAL LEVELS
 * ============================================================================
 *
 *   node scripts/importLocalLevels.js path/to/local-levels.csv
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS AN IMPORT AND NOT A CONSTANT
 * ---------------------------------------------------------------------------
 * The 7 provinces and 77 districts are stable and small, so they live in code
 * (`src/lib/nepal/administrative.js`). The 753 local levels are different: they
 * carry ward counts, they have been revised since 2017, and they will be
 * revised again. Hand-transcribing 753 names and ward counts would put typos
 * into the one reference table that every address, every HMIS return and every
 * insurance catchment is keyed on — and a typo there is invisible until a
 * district officer queries a number.
 *
 * So the authoritative list is loaded from the official MoFAGA dataset. The six
 * metropolitan and eleven sub-metropolitan cities ship inline as a working
 * baseline (see `MAJOR_LOCAL_LEVELS`) so a fresh install can register urban
 * patients on day one; this script fills in the rest.
 *
 * ---------------------------------------------------------------------------
 * CSV FORMAT
 * ---------------------------------------------------------------------------
 * Header row required. Recognised columns (case-insensitive, flexible order):
 *
 *   district      District name in English, or its code (P3-D05)
 *   name          Local level name in English
 *   name_ne       Local level name in Devanagari
 *   type          metropolitan | sub_metropolitan | municipality | rural_municipality
 *   wards         Number of wards
 *   code          Optional; generated from the district when absent
 *
 * The import is idempotent — re-running updates names and ward counts in place
 * rather than duplicating, so a corrected dataset can simply be re-applied.
 */
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import {
  DISTRICTS,
  LOCAL_LEVEL_TYPE_VALUES,
  MAJOR_LOCAL_LEVELS,
} from '../src/utils/nepal.js';

const { Schema } = mongoose;

/**
 * Reference collection. Deliberately not `auditable` — this is public
 * administrative geography, not clinical or financial data, and an audit row
 * per municipality on every import would drown the trail that matters.
 */
const localLevelSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    districtCode: { type: String, required: true, index: true },
    type: { type: String, enum: LOCAL_LEVEL_TYPE_VALUES, required: true },
    en: { type: String, required: true, trim: true },
    ne: { type: String, trim: true, default: '' },
    wards: { type: Number, required: true, min: 1, max: 35 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'localLevels' },
);

localLevelSchema.index({ districtCode: 1, en: 1 });

const LocalLevel =
  mongoose.models.LocalLevel || mongoose.model('LocalLevel', localLevelSchema);

/** Minimal CSV reader — handles quoted fields containing commas. */
function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const DISTRICT_BY_NAME = new Map(
  DISTRICTS.flatMap((d) => [
    [d.en.toLowerCase(), d.code],
    [d.ne, d.code],
    [d.code.toLowerCase(), d.code],
  ]),
);

/** Accept a district name (either script) or a code. */
function resolveDistrict(raw) {
  const key = String(raw || '').trim().toLowerCase();
  return DISTRICT_BY_NAME.get(key) || DISTRICT_BY_NAME.get(String(raw || '').trim()) || null;
}

const TYPE_ALIASES = {
  'metropolitan city': 'metropolitan',
  metropolitan: 'metropolitan',
  mahanagarpalika: 'metropolitan',
  'sub-metropolitan city': 'sub_metropolitan',
  'sub metropolitan': 'sub_metropolitan',
  sub_metropolitan: 'sub_metropolitan',
  upamahanagarpalika: 'sub_metropolitan',
  municipality: 'municipality',
  nagarpalika: 'municipality',
  'rural municipality': 'rural_municipality',
  rural_municipality: 'rural_municipality',
  gaunpalika: 'rural_municipality',
};

function resolveType(raw) {
  return TYPE_ALIASES[String(raw || '').trim().toLowerCase()] || null;
}

async function importFromCsv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('The CSV has no data rows.');

  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const columnOf = (name) => header.indexOf(name);

  const idx = {
    district: columnOf('district'),
    name: columnOf('name'),
    nameNe: columnOf('name_ne'),
    type: columnOf('type'),
    wards: columnOf('wards'),
    code: columnOf('code'),
  };

  for (const [key, position] of Object.entries(idx)) {
    if (position === -1 && ['district', 'name', 'type', 'wards'].includes(key)) {
      throw new Error(`The CSV is missing a required "${key}" column.`);
    }
  }

  // Per-district counters, so a generated code is stable and collision-free.
  const perDistrict = new Map();
  let created = 0;
  let updated = 0;
  const rejected = [];

  for (const row of rows.slice(1)) {
    const districtCode = resolveDistrict(row[idx.district]);
    const type = resolveType(row[idx.type]);
    const name = (row[idx.name] || '').trim();
    const wards = Number(row[idx.wards]);

    // A row we cannot place is collected and reported, never guessed at — a
    // municipality filed under the wrong district silently misroutes every
    // patient from it.
    if (!districtCode || !type || !name || !Number.isInteger(wards) || wards < 1) {
      rejected.push({
        row: row.join(','),
        reason: !districtCode
          ? `unknown district "${row[idx.district]}"`
          : !type
            ? `unknown type "${row[idx.type]}"`
            : !name
              ? 'missing name'
              : `invalid ward count "${row[idx.wards]}"`,
      });
      continue;
    }

    const next = (perDistrict.get(districtCode) || 0) + 1;
    perDistrict.set(districtCode, next);

    const code =
      (idx.code >= 0 && row[idx.code]?.trim()) ||
      `${districtCode}-L${String(next).padStart(2, '0')}`;

    const doc = {
      code,
      districtCode,
      type,
      en: name,
      ne: idx.nameNe >= 0 ? (row[idx.nameNe] || '').trim() : '',
      wards,
      isActive: true,
    };

    const result = await LocalLevel.updateOne({ code }, { $set: doc }, { upsert: true });
    if (result.upsertedCount) created += 1;
    else if (result.modifiedCount) updated += 1;
  }

  return { created, updated, rejected, total: rows.length - 1 };
}

/** Load the inline metropolitan/sub-metropolitan baseline. */
async function seedMajorLocalLevels() {
  let created = 0;
  for (const level of MAJOR_LOCAL_LEVELS) {
    const result = await LocalLevel.updateOne(
      { code: level.code },
      {
        $set: {
          code: level.code,
          districtCode: level.district,
          type: level.type,
          en: level.en,
          ne: level.ne,
          wards: level.wards,
          isActive: true,
        },
      },
      { upsert: true },
    );
    if (result.upsertedCount) created += 1;
  }
  return created;
}

async function main() {
  const filePath = process.argv[2];
  await connectDatabase();

  try {
    const baseline = await seedMajorLocalLevels();
    if (baseline > 0) {
      console.log(`[local-levels] seeded ${baseline} metropolitan / sub-metropolitan cities`);
    }

    if (!filePath) {
      const count = await LocalLevel.countDocuments({ isActive: true });
      console.log(`[local-levels] ${count} local levels present.`);
      if (count < 753) {
        console.log(
          `[local-levels] ⚠ Nepal has 753. ${753 - count} are missing — addresses outside\n` +
            '               the major cities cannot be recorded precisely until they are loaded.\n' +
            '               Run: node scripts/importLocalLevels.js <mofaga-export.csv>',
        );
      }
      return;
    }

    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) throw new Error(`No such file: ${resolved}`);

    const { created, updated, rejected, total } = await importFromCsv(resolved);
    console.log(`[local-levels] ${total} rows read — ${created} created, ${updated} updated.`);

    if (rejected.length > 0) {
      console.log(`[local-levels] ⚠ ${rejected.length} rows could not be placed:`);
      for (const bad of rejected.slice(0, 20)) {
        console.log(`   ${bad.reason}: ${bad.row.slice(0, 90)}`);
      }
      if (rejected.length > 20) console.log(`   … and ${rejected.length - 20} more`);
      // A non-zero exit so a commissioning script does not treat a partial
      // import as a success.
      process.exitCode = 1;
    }

    const finalCount = await LocalLevel.countDocuments({ isActive: true });
    console.log(`[local-levels] ${finalCount} of 753 loaded.`);
  } finally {
    await disconnectDatabase();
  }
}

main().catch((error) => {
  console.error('[local-levels] import failed:', error.message);
  process.exitCode = 1;
});

export { LocalLevel };
