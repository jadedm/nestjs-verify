import type { Pool, PoolClient } from 'pg';
import { MIGRATIONS, PACKAGE_NAME } from './migrations.js';

/**
 * Stable advisory-lock key. Chosen by hashing the package name to fit in
 * a 32-bit signed int, the type pg_advisory_lock takes when called
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

/** A promise's outcome as a value, so cleanup can run and the first error still win. */
const settle = <T>(p: Promise<T>): Promise<[T, null] | [null, unknown]> =>
  p.then(
    (v): [T, null] => [v, null],
    (e: unknown): [null, unknown] => [null, e],
  );

/**
 * A migration that failed. When its ROLLBACK also failed, the connection's
 * transaction state is unknown, so it must not go back to the pool.
 */
class MigrationFailedError extends Error {
  constructor(
    message: string,
    readonly connectionUnusable: boolean,
    cause: unknown,
  ) {
    super(message, { cause });
    this.name = 'MigrationFailedError';
  }
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

const connectionUnusable = (err: unknown) =>
  err instanceof MigrationFailedError && err.connectionUnusable;

/**
 * Idempotent migration runner. Safe to call from multiple racing application
 * instances thanks to pg_advisory_lock, which makes later callers wait. Each migration is wrapped in a
 * transaction; on failure, the entire migration is rolled back and the
 * version counter is not advanced.
 *
 * The first error is the one reported. A failed ROLLBACK or unlock never
 * replaces it, and a client left in an unknown state is discarded rather
 * than returned to the pool (#69).
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
  // pg-pool drops its own error listener while a client is checked out, so a
  // socket error (a reset, a dropped network) would be an uncaught exception
  // that ends the process. The same error also rejects the query in flight,
  // which is where it is reported.
  const ignoreSocketError = () => undefined;
  client.on('error', ignoreSocketError);
  const giveBack = (discard: boolean) => {
    client.removeListener('error', ignoreSocketError);
    client.release(discard);
  };

  // Waits while another instance holds the lock and runs its migrations.
  const [, lockErr] = await settle(client.query(`SELECT pg_advisory_lock($1)`, [ADVISORY_LOCK_KEY]));
  if (lockErr !== null) {
    giveBack(true);
    throw lockErr;
  }

  const [, migrateErr] = await settle(applyPending(client));
  const [, unlockErr] = await settle(
    client.query(`SELECT pg_advisory_unlock($1)`, [ADVISORY_LOCK_KEY]),
  );
  // Discarding the client closes its session, which also frees the advisory
  // lock and any transaction a failed ROLLBACK left open.
  giveBack(unlockErr !== null || connectionUnusable(migrateErr));
  if (migrateErr !== null) throw migrateErr;
  if (unlockErr !== null) throw unlockErr;
}

async function applyPending(client: PoolClient): Promise<void> {
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
    const [, err] = await settle(applyOne(client, m.sql, m.version));
    if (err === null) continue;
    const [, rollbackErr] = await settle(client.query('ROLLBACK'));
    const note = rollbackErr !== null ? `; ROLLBACK also failed: ${messageOf(rollbackErr)}` : '';
    throw new MigrationFailedError(
      `Migration ${m.version} (${m.description}) failed: ${messageOf(err)}${note}`,
      rollbackErr !== null,
      err,
    );
  }
}

async function applyOne(client: PoolClient, sql: string, version: number): Promise<void> {
  await client.query('BEGIN');
  await client.query(sql);
  await client.query(
    `INSERT INTO verify_schema_versions (package, version)
     VALUES ($1, $2)
     ON CONFLICT (package) DO UPDATE
     SET version = EXCLUDED.version, applied_at = NOW()`,
    [PACKAGE_NAME, version],
  );
  await client.query('COMMIT');
}

// Postgres's error code for a table that does not exist.
const UNDEFINED_TABLE = '42P01';

async function ensureVersionIsCurrent(pool: Pool): Promise<void> {
  const latest = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
  const [result, err] = await settle(
    pool.query<{ version: number }>(
      `SELECT version FROM verify_schema_versions WHERE package = $1`,
      [PACKAGE_NAME],
    ),
  );
  // Only a missing table means "nothing applied yet". A refused connection or
  // a wrong password must not read as "database is at 0" (#69).
  if (err !== null && (err as { code?: unknown } | undefined)?.code !== UNDEFINED_TABLE) throw err;
  const current = result?.rows[0]?.version ?? 0;
  if (current !== latest) {
    throw new Error(
      `${PACKAGE_NAME} schema version mismatch: database is at ${current}, library expects ${latest}. ` +
      `skipSchemaSetup is true, so run the missing migrations via your migration tool. ` +
      `SQL is available via the exported MIGRATIONS array.`,
    );
  }
}
