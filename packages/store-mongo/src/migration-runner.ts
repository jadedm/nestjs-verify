import type { Db } from 'mongodb';
import { MIGRATIONS, PACKAGE_NAME } from './migrations.js';

interface VersionDoc {
  _id: string;
  version: number;
  appliedAt: Date;
  /** When set in the future, another instance is mid-migration. */
  lockUntil?: Date;
}

const META_COLLECTION = 'verify_schema_versions';
const LOCK_TIMEOUT_MS = 60_000;

export interface RunMigrationsOptions {
  skipSchemaSetup?: boolean;
}

/**
 * Idempotent Mongo migration runner. Uses a sentinel document with a
 * `lockUntil` field to serialize concurrent migration attempts across
 * application instances. Mongo does not have advisory locks, so this is
 * the standard pattern.
 */
export async function runMongoMigrations(
  db: Db,
  opts: RunMigrationsOptions = {},
): Promise<void> {
  const meta = db.collection<VersionDoc>(META_COLLECTION);
  const latest = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

  if (opts.skipSchemaSetup) {
    const doc = await meta.findOne({ _id: PACKAGE_NAME });
    const current = doc?.version ?? 0;
    if (current !== latest) {
      throw new Error(
        `${PACKAGE_NAME} schema version mismatch: database is at ${current}, library expects ${latest}. ` +
        `skipSchemaSetup is true, so run the missing migrations via your migration tool. ` +
        `Migrations are available via the exported MIGRATIONS array.`,
      );
    }
    return;
  }

  // Acquire the lock by atomically setting lockUntil if it's absent or stale.
  const now = new Date();
  const lockUntil = new Date(now.getTime() + LOCK_TIMEOUT_MS);
  await meta.updateOne(
    { _id: PACKAGE_NAME },
    {
      $setOnInsert: { version: 0, appliedAt: now },
    },
    { upsert: true },
  );

  // Try to acquire the lock. Loop in case another instance holds it.
  let lockAcquired = false;
  for (let i = 0; i < 60 && !lockAcquired; i++) {
    const res = await meta.findOneAndUpdate(
      {
        _id: PACKAGE_NAME,
        $or: [{ lockUntil: { $exists: false } }, { lockUntil: { $lt: new Date() } }],
      },
      { $set: { lockUntil } },
      { returnDocument: 'after' },
    );
    if (res) {
      lockAcquired = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!lockAcquired) {
    throw new Error(
      `${PACKAGE_NAME}: could not acquire migration lock after 60s. Another instance may be stuck.`,
    );
  }

  try {
    const doc = await meta.findOne({ _id: PACKAGE_NAME });
    const current = doc?.version ?? 0;
    if (current > latest) {
      throw new Error(
        `Schema version ${current} is newer than this library expects (${latest}). ` +
        `You likely downgraded ${PACKAGE_NAME}. Refusing to start.`,
      );
    }

    const pending = MIGRATIONS.filter((m) => m.version > current);
    for (const m of pending) {
      try {
        await m.apply(db);
        await meta.updateOne(
          { _id: PACKAGE_NAME },
          { $set: { version: m.version, appliedAt: new Date() } },
        );
      } catch (err) {
        throw new Error(
          `Migration ${m.version} (${m.description}) failed: ${
            (err as Error).message
          }`,
        );
      }
    }
  } finally {
    await meta.updateOne(
      { _id: PACKAGE_NAME },
      { $unset: { lockUntil: '' } },
    );
  }
}
