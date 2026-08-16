/**
 * Schema migrations — idempotent, safe to run repeatedly.
 *
 *   npm run migrate            apply everything outstanding
 *   npm run migrate -- --dry   report what would change, write nothing
 *
 * Each migration is a named function that reports what it did. They must be
 * safe to re-run: check before you write, and never assume you are the first.
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/config/db.js';
import { VitalSigns } from '../src/models/index.js';
import { evaluateVitals } from '../src/services/vitalsService.js';

const DRY_RUN = process.argv.includes('--dry');

/**
 * Phase 3 — observations moved out of `encounters.vitals` into the `vitalSigns`
 * collection, because a single embedded object cannot hold a series: recording
 * a second set silently overwrote the first.
 *
 * `encounters.vitals` is no longer in the schema, so Mongoose will not return
 * it — this reads the raw collection to find what is still there.
 */
async function migrateEmbeddedVitals() {
  const raw = mongoose.connection.collection('encounters');

  const stale = await raw
    .find({ vitals: { $exists: true, $ne: null } })
    .project({ _id: 1, patientId: 1, vitals: 1, startedAt: 1, createdBy: 1 })
    .toArray();

  if (stale.length === 0) {
    return { name: 'embedded vitals → vitalSigns', changed: 0, note: 'nothing to migrate' };
  }

  let moved = 0;
  let skipped = 0;

  for (const encounter of stale) {
    const { vitals } = encounter;

    // Only the measurements — an embedded blob with nothing in it is not a reading.
    const hasReading = [
      'temperatureC', 'pulseBpm', 'respiratoryRate', 'systolicBp',
      'diastolicBp', 'spo2', 'weightKg', 'heightCm',
    ].some((field) => vitals[field] !== undefined && vitals[field] !== null);

    if (!hasReading) {
      if (!DRY_RUN) await raw.updateOne({ _id: encounter._id }, { $unset: { vitals: '' } });
      skipped += 1;
      continue;
    }

    const recordedAt = vitals.recordedAt ?? encounter.startedAt ?? new Date();

    // Re-runnable: if this reading already moved, don't duplicate it.
    const exists = await VitalSigns.exists({ encounterId: encounter._id, recordedAt });
    if (exists) {
      if (!DRY_RUN) await raw.updateOne({ _id: encounter._id }, { $unset: { vitals: '' } });
      skipped += 1;
      continue;
    }

    if (!DRY_RUN) {
      const reading = new VitalSigns({
        temperatureC: vitals.temperatureC,
        pulseBpm: vitals.pulseBpm,
        respiratoryRate: vitals.respiratoryRate,
        systolicBp: vitals.systolicBp,
        diastolicBp: vitals.diastolicBp,
        spo2: vitals.spo2,
        weightKg: vitals.weightKg,
        heightCm: vitals.heightCm,
        patientId: encounter.patientId,
        encounterId: encounter._id,
        // The original reading did not record who took it.
        recordedBy: encounter.createdBy,
        recordedAt,
        notes: 'Migrated from the encounter record (Phase 3).',
        createdBy: encounter.createdBy,
        updatedBy: encounter.createdBy,
      });
      evaluateVitals(reading);
      await reading.save();

      await raw.updateOne({ _id: encounter._id }, { $unset: { vitals: '' } });
    }
    moved += 1;
  }

  return {
    name: 'embedded vitals → vitalSigns',
    changed: moved,
    note: `${moved} reading(s) moved, ${skipped} empty//already-migrated cleared`,
  };
}

const MIGRATIONS = [migrateEmbeddedVitals];

async function run() {
  await connectDatabase();

  if (DRY_RUN) console.log('[migrate] DRY RUN — no writes will be made\n');

  for (const migration of MIGRATIONS) {
    const result = await migration();
    console.log(`[migrate] ${result.name}: ${result.changed} changed — ${result.note}`);
  }

  console.log('\n[migrate] done.');
  await disconnectDatabase();
  await mongoose.disconnect().catch(() => {});
  process.exit(0);
}

run().catch(async (error) => {
  console.error('[migrate] failed:', error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
