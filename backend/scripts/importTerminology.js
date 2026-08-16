/**
 * ============================================================================
 * IMPORT A CLINICAL TERMINOLOGY
 * ============================================================================
 *
 *   node scripts/importTerminology.js --system icd-10 --file icd10.csv --version 2019
 *   node scripts/importTerminology.js --system loinc  --file loinc.csv --version 2.77
 *   node scripts/importTerminology.js --list
 *
 * ---------------------------------------------------------------------------
 * WHY THE CONTENT IS NOT IN THIS REPOSITORY
 * ---------------------------------------------------------------------------
 * ICD-11, LOINC and SNOMED CT are large, versioned and separately licensed.
 * SNOMED CT in particular requires a member-country affiliate licence, and
 * whether a Nepali hospital may load it depends on Nepal's affiliation status —
 * not something this codebase can assert on anyone's behalf. Vendoring any of
 * them would be both a licensing claim we cannot make and a snapshot that goes
 * stale the moment it ships.
 *
 * So the hospital obtains the release from the publisher (WHO for ICD,
 * Regenstrief for LOINC, SNOMED International / the national release centre)
 * and loads it here.
 *
 * ---------------------------------------------------------------------------
 * CSV FORMAT
 * ---------------------------------------------------------------------------
 * Header row required; column order is free. Recognised columns:
 *
 *   code        (required) the concept code, e.g. J18.9
 *   display     (required) the preferred term
 *   display_ne  Nepali term, where a translation exists
 *   parent      parent code — used to build the ancestor chain
 *   chapter     ICD chapter / LOINC class
 *   is_leaf     true|false — non-leaves are category headings and not codable
 *   selectable  true|false — false for retired codes
 *   synonyms    pipe-separated alternative terms, for search
 *   notifiable  true|false — fires the EWARS alert on entry
 *   property    LOINC: what is measured
 *   specimen    LOINC: on what
 *   unit        LOINC: in what units
 *
 * Ancestors are derived from `parent` after the load, so the file need only
 * state each concept's immediate parent.
 */
import fs from 'node:fs';
import path from 'node:path';
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { CodeSystem } from '../src/models/index.js';
import { CODE_SYSTEM_VALUES, CODE_SYSTEM_LABELS } from '../src/models/CodeSystem.js';
import { clearInstalledCache, installedSystems } from '../src/services/terminologyService.js';

/** Minimal CSV reader — handles quoted fields containing commas and newlines. */
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

const truthy = (v) => ['true', '1', 'yes', 'y'].includes(String(v || '').trim().toLowerCase());

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

/**
 * Build each concept's full ancestor chain from its parent pointer.
 *
 * Denormalised so "every respiratory diagnosis" is one indexed query rather
 * than a recursive walk per row. Done in memory after the load because doing it
 * per-row during insert would be O(depth) database round trips per concept, and
 * an ICD release is tens of thousands of concepts.
 */
function buildAncestors(concepts) {
  const byCode = new Map(concepts.map((c) => [c.code, c]));
  const cache = new Map();

  const ancestorsOf = (code, seen = new Set()) => {
    if (cache.has(code)) return cache.get(code);
    // A malformed file can contain a parent cycle; refuse to loop on it.
    if (seen.has(code)) return [];
    seen.add(code);

    const concept = byCode.get(code);
    const parent = concept?.parent;
    if (!parent || !byCode.has(parent)) {
      cache.set(code, []);
      return [];
    }
    const chain = [parent, ...ancestorsOf(parent, seen)];
    cache.set(code, chain);
    return chain;
  };

  for (const concept of concepts) concept.ancestors = ancestorsOf(concept.code);
  return concepts;
}

async function importFile({ system, file, version, replace }) {
  const text = fs.readFileSync(path.resolve(file), 'utf8');
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('The CSV has no data rows.');

  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const col = (name) => header.indexOf(name);

  const idx = {
    code: col('code'),
    display: col('display'),
    displayNe: col('display_ne'),
    parent: col('parent'),
    chapter: col('chapter'),
    isLeaf: col('is_leaf'),
    selectable: col('selectable'),
    synonyms: col('synonyms'),
    notifiable: col('notifiable'),
    property: col('property'),
    specimen: col('specimen'),
    unit: col('unit'),
  };

  if (idx.code === -1 || idx.display === -1) {
    throw new Error('The CSV must have at least "code" and "display" columns.');
  }

  const at = (row, i) => (i >= 0 ? (row[i] || '').trim() : '');

  const concepts = [];
  const rejected = [];

  for (const row of rows.slice(1)) {
    const code = at(row, idx.code).toUpperCase();
    const display = at(row, idx.display);
    if (!code || !display) {
      rejected.push({ row: row.join(',').slice(0, 90), reason: 'missing code or display' });
      continue;
    }

    const synonyms = at(row, idx.synonyms)
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);

    concepts.push({
      system,
      version,
      code,
      display,
      displayNe: at(row, idx.displayNe),
      parent: at(row, idx.parent).toUpperCase(),
      chapter: at(row, idx.chapter),
      // Default true: most rows in a release are codable leaves, and a file that
      // omits the column should not make the whole terminology unusable.
      isLeaf: idx.isLeaf === -1 ? true : truthy(at(row, idx.isLeaf)),
      isSelectable: idx.selectable === -1 ? true : truthy(at(row, idx.selectable)),
      synonyms,
      isNotifiable: idx.notifiable === -1 ? false : truthy(at(row, idx.notifiable)),
      property: at(row, idx.property),
      specimen: at(row, idx.specimen),
      unit: at(row, idx.unit),
      searchText: [display, ...synonyms].join(' ').toLowerCase().replace(/\s+/g, ' ').trim(),
    });
  }

  buildAncestors(concepts);

  if (replace) {
    const { deletedCount } = await CodeSystem.deleteMany({ system, version });
    if (deletedCount) console.log(`[terminology] removed ${deletedCount} existing ${system} ${version} concepts`);
  }

  // Bulk upsert in batches — an ICD release is tens of thousands of rows, and
  // one write per concept would take minutes.
  const BATCH = 1000;
  let written = 0;
  for (let i = 0; i < concepts.length; i += BATCH) {
    const batch = concepts.slice(i, i + BATCH);
    await CodeSystem.bulkWrite(
      batch.map((doc) => ({
        updateOne: {
          filter: { system: doc.system, code: doc.code, version: doc.version },
          update: { $set: doc },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    written += batch.length;
    if (written % 10000 === 0) console.log(`[terminology] ${written}/${concepts.length}…`);
  }

  clearInstalledCache();
  return { written, rejected, total: rows.length - 1 };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await connectDatabase();

  try {
    if (args.list) {
      const { installed, missing } = await installedSystems();
      console.log('\nInstalled terminologies:');
      if (installed.length === 0) console.log('  (none)');
      for (const row of installed) {
        console.log(`  ${row.label.padEnd(20)} v${(row.version || '—').padEnd(10)} ${row.concepts} concepts`);
      }
      if (missing.length > 0) {
        console.log('\nNot installed:');
        for (const row of missing) console.log(`  ${row.label.padEnd(20)} (${row.use})`);
        console.log('\nCoding against a system that is not installed is refused, not silently accepted.');
      }
      return;
    }

    const { system, file, version = '', replace } = args;

    if (!system || !file) {
      console.log('Usage: node scripts/importTerminology.js --system <id> --file <csv> [--version v] [--replace]');
      console.log(`       node scripts/importTerminology.js --list\n`);
      console.log('Systems:', CODE_SYSTEM_VALUES.join(', '));
      process.exitCode = 1;
      return;
    }

    if (!CODE_SYSTEM_VALUES.includes(system)) {
      throw new Error(`"${system}" is not a known code system. One of: ${CODE_SYSTEM_VALUES.join(', ')}`);
    }
    if (!fs.existsSync(path.resolve(file))) throw new Error(`No such file: ${file}`);

    const label = CODE_SYSTEM_LABELS[system]?.en || system;
    console.log(`[terminology] importing ${label} ${version || '(no version)'} from ${file}`);

    const { written, rejected, total } = await importFile({
      system,
      file,
      version,
      replace: Boolean(replace),
    });

    console.log(`[terminology] ${total} rows read, ${written} concepts written.`);

    if (rejected.length > 0) {
      console.log(`[terminology] ⚠ ${rejected.length} rows skipped:`);
      for (const bad of rejected.slice(0, 10)) console.log(`   ${bad.reason}: ${bad.row}`);
      if (rejected.length > 10) console.log(`   … and ${rejected.length - 10} more`);
      // Non-zero exit so a commissioning script does not treat a partial import
      // as success — a terminology with holes produces silently wrong coding.
      process.exitCode = 1;
    }
  } finally {
    await disconnectDatabase();
  }
}

main().catch((error) => {
  console.error('[terminology] import failed:', error.message);
  process.exitCode = 1;
});
