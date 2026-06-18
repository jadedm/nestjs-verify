import { Pool } from 'pg';
import { MIGRATIONS, PACKAGE_NAME } from './migrations.js';

/**
 * Stable advisory-lock key. Chosen by hashing the package name to fit in
 * a 32-bit signed int, the type pg_try_advisory_lock takes when called
 * with a single argument.
 */
const ADVISORY_LOCK_KEY = 0x4a564d50; // 'JVMP' as ascii, ~ 1247563600

const META_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS verify_schema_versions (
    package TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

export interface RunMigrationsOptions {
  /** When true, skip all DDL. Library will still refuse to start on version mismatch. */
  skipSchemaSetup?: boolean;
}

/**
 * Idempotent migration runner. Safe to call from multiple racing application
 * instances thanks to pg_try_advisory_lock. Each migration is wrapped in a
 * transaction; on failure, the entire migration is rolled back and the
 * version counter is not advanced.
 */
export async function runMigrations(
  pool: Pool,
  opts: RunMigrationsOptions = {},
): Promise<void> {
  if (opts.skipSchemaSetup) {
    await ensureVersionIsCurrent(pool);
    return;
  }

  const client = await pool.connect();
  try {
    // Attempt to acquire the advisory lock. If we can't get it, another
    // instance is running migrations; wait until it releases.
    await client.query(`SELECT pg_advisory_lock($1)`, [ADVISORY_LOCK_KEY]);
    try {
      await client.query(META_TABLE_DDL);
      const { rows } = await client.query<{ version: number }>(
        `SELECT version FROM verify_schema_versions WHERE package = $1`,
        [PACKAGE_NAME],
      );
      const current = rows[0]?.version ?? 0;
      const latest = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

      if (current > latest) {
        throw new Error(
          `Schema version ${current} is newer than this library expects (${latest}). ` +
          `You likely downgraded ${PACKAGE_NAME}. Refusing to start.`,
        );
      }

      const pending = MIGRATIONS.filter((m) => m.version > current);
      for (const m of pending) {
        await client.query('BEGIN');
        try {
          await client.query(m.sql);
          await client.query(
            `INSERT INTO verify_schema_versions (package, version)
             VALUES ($1, $2)
             ON CONFLICT (package) DO UPDATE
             SET version = EXCLUDED.version, applied_at = NOW()`,
            [PACKAGE_NAME, m.version],
          );
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw new Error(
            `Migration ${m.version} (${m.description}) failed: ${
              (err as Error).message
            }`,
          );
        }
      }
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1)`, [ADVISORY_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

async function ensureVersionIsCurrent(pool: Pool): Promise<void> {
  const latest = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
  let current = 0;
  try {
    const { rows } = await pool.query<{ version: number }>(
      `SELECT version FROM verify_schema_versions WHERE package = $1`,
      [PACKAGE_NAME],
    );
    current = rows[0]?.version ?? 0;
  } catch {
    // table missing
  }
  if (current !== latest) {
    throw new Error(
      `${PACKAGE_NAME} schema version mismatch: database is at ${current}, library expects ${latest}. ` +
      `skipSchemaSetup is true, so run the missing migrations via your migration tool. ` +
      `SQL is available via the exported MIGRATIONS array.`,
    );
  }
}
