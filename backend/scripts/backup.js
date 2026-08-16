/**
 * ============================================================================
 * BACKUP AND RESTORE (D5)
 * ============================================================================
 *
 *   node scripts/backup.js create
 *   node scripts/backup.js list
 *   node scripts/backup.js verify <path>
 *   node scripts/backup.js restore <path> --confirm
 *
 * ---------------------------------------------------------------------------
 * AN UNTESTED BACKUP IS NOT A BACKUP
 * ---------------------------------------------------------------------------
 * The commonest failure is not the absence of backups — it is a hospital that
 * has taken them nightly for two years and discovers on the worst day that none
 * of them restores. So `verify` exists as a first-class command and the drill is
 * meant to be run on a schedule, not intended and forgotten.
 *
 * ---------------------------------------------------------------------------
 * THE UPLOADS DIRECTORY IS PART OF THE BACKUP
 * ---------------------------------------------------------------------------
 * Lab reports, radiology reports, scanned consent forms and referral letters
 * live on disk, OUTSIDE the database. A mongodump-only backup restores a system
 * whose every document link is broken, which nobody notices until a patient
 * asks for a copy of their report.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import config from '../src/config/env.js';

const BACKUP_ROOT = process.env.BACKUP_DIR || path.resolve('backups');

const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (error) =>
      reject(new Error(`${command} could not be run (${error.message}). Is it on PATH?`)),
    );
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}: ${stderr.slice(-500)}`)),
    );
  });

/** SHA-256 over a directory tree, so a corrupted restore is detectable. */
async function checksumTree(root) {
  const hash = crypto.createHash('sha256');
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        hash.update(path.relative(root, full).replace(/\\/g, '/'));
        hash.update(fs.readFileSync(full));
      }
    }
  };
  walk(root);
  return hash.digest('hex');
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) return 0;
  fs.mkdirSync(to, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) count += copyDir(src, dest);
    else {
      fs.copyFileSync(src, dest);
      count += 1;
    }
  }
  return count;
}

async function create() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(BACKUP_ROOT, stamp);
  fs.mkdirSync(target, { recursive: true });

  console.log(`[backup] writing to ${target}`);

  await run('mongodump', ['--uri', config.mongoUri, '--out', path.join(target, 'db'), '--quiet']);
  console.log('[backup] database dumped');

  const uploadCount = copyDir(config.uploadsDir, path.join(target, 'uploads'));
  console.log(`[backup] ${uploadCount} generated document(s) copied`);

  const manifest = {
    createdAt: new Date().toISOString(),
    mongoUri: config.mongoUri.replace(/\/\/[^@]*@/, '//***@'), // never store credentials
    uploadCount,
    checksum: await checksumTree(target),
    hospital: config.hospital.name,
    nodeVersion: process.version,
  };
  fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`[backup] complete — checksum ${manifest.checksum.slice(0, 16)}…`);
  console.log('[backup] ⚠ Copy this OFF this machine. A backup on the same disk is not a backup.');
  return target;
}

/**
 * Verify a backup without restoring it.
 *
 * Checks the manifest, the checksum, and that the dump actually contains the
 * collections that matter — a mongodump can "succeed" and produce an empty
 * directory if the URI pointed at the wrong database.
 */
async function verify(target) {
  const manifestPath = path.join(target, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('No manifest.json — this is not a backup directory.');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const problems = [];

  // Checksum the tree as it was checksummed at creation: excluding the
  // manifest, which did not exist yet.
  const tmp = path.join(BACKUP_ROOT, `.verify-${Date.now()}`);
  fs.mkdirSync(tmp, { recursive: true });
  try {
    for (const entry of fs.readdirSync(target)) {
      if (entry === 'manifest.json') continue;
      const src = path.join(target, entry);
      if (fs.statSync(src).isDirectory()) copyDir(src, path.join(tmp, entry));
      else fs.copyFileSync(src, path.join(tmp, entry));
    }
    const actual = await checksumTree(tmp);
    if (actual !== manifest.checksum) problems.push('Checksum mismatch — the backup has been altered or is corrupt.');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const dbDir = path.join(target, 'db');
  if (!fs.existsSync(dbDir)) problems.push('No database dump present.');
  else {
    const dbs = fs.readdirSync(dbDir);
    if (dbs.length === 0) problems.push('The database dump is empty.');
    else {
      const collections = fs.readdirSync(path.join(dbDir, dbs[0])).filter((f) => f.endsWith('.bson'));
      // A dump with no patients is not a hospital backup, whatever the exit code said.
      const essential = ['patients.bson', 'users.bson', 'encounters.bson'];
      const missing = essential.filter((c) => !collections.includes(c));
      if (missing.length > 0) problems.push(`Essential collections missing: ${missing.join(', ')}`);
      console.log(`[verify] ${collections.length} collection(s) in the dump`);
    }
  }

  if (problems.length > 0) {
    console.error('[verify] FAILED:');
    for (const problem of problems) console.error(`   - ${problem}`);
    process.exitCode = 1;
    return false;
  }

  console.log(`[verify] OK — taken ${manifest.createdAt}, ${manifest.uploadCount} document(s)`);
  return true;
}

/**
 * Restore. Requires --confirm, because this overwrites live data.
 *
 * `--drop` is passed to mongorestore deliberately: restoring INTO an existing
 * database without it merges old and new, which produces a state that never
 * existed and is far harder to reason about than either.
 */
async function restore(target, confirmed) {
  if (!confirmed) {
    console.error('[restore] This OVERWRITES the current database. Re-run with --confirm.');
    process.exitCode = 1;
    return;
  }

  if (!(await verify(target))) {
    console.error('[restore] refusing to restore a backup that failed verification.');
    process.exitCode = 1;
    return;
  }

  const dbDir = path.join(target, 'db');
  const dumped = fs.readdirSync(dbDir)[0];

  await run('mongorestore', ['--uri', config.mongoUri, '--drop', '--quiet', path.join(dbDir, dumped)]);
  console.log('[restore] database restored');

  const uploadsBackup = path.join(target, 'uploads');
  if (fs.existsSync(uploadsBackup)) {
    const count = copyDir(uploadsBackup, config.uploadsDir);
    console.log(`[restore] ${count} generated document(s) restored`);
  }

  console.log('[restore] complete. Verify a patient chart and a recent invoice before resuming service.');
}

function list() {
  if (!fs.existsSync(BACKUP_ROOT)) {
    console.log('[backup] no backups yet.');
    return;
  }
  const entries = fs.readdirSync(BACKUP_ROOT).filter((e) => fs.existsSync(path.join(BACKUP_ROOT, e, 'manifest.json')));
  if (entries.length === 0) {
    console.log('[backup] no backups yet.');
    return;
  }
  for (const entry of entries.sort().reverse()) {
    const manifest = JSON.parse(fs.readFileSync(path.join(BACKUP_ROOT, entry, 'manifest.json'), 'utf8'));
    console.log(`  ${entry}  ${manifest.uploadCount} docs  ${manifest.checksum.slice(0, 12)}…`);
  }

  const newest = entries.sort().reverse()[0];
  const age = (Date.now() - new Date(newest.replace(/-/g, ':')).getTime()) / 86400000;
  if (Number.isFinite(age) && age > 2) {
    console.log(`\n⚠ The most recent backup is ${Math.round(age)} days old.`);
  }
}

const [command, arg] = process.argv.slice(2);
const confirmed = process.argv.includes('--confirm');

const commands = {
  create,
  list: async () => list(),
  verify: async () => {
    if (!arg) throw new Error('Usage: backup.js verify <path>');
    await verify(path.resolve(arg));
  },
  restore: async () => {
    if (!arg) throw new Error('Usage: backup.js restore <path> --confirm');
    await restore(path.resolve(arg), confirmed);
  },
};

if (!commands[command]) {
  console.log('Usage: node scripts/backup.js create | list | verify <path> | restore <path> --confirm');
  process.exitCode = 1;
} else {
  commands[command]().catch((error) => {
    console.error(`[backup] ${error.message}`);
    process.exitCode = 1;
  });
}
