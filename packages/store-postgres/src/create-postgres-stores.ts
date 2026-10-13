import { Pool, PoolConfig } from 'pg';
import { PostgresVerifyStore } from './postgres-verify.store.js';
import { PostgresAbuseStore } from './postgres-abuse.store.js';
import { PostgresRateLimitStore } from './postgres-rate-limit.store.js';
import { PostgresCooldownStore } from './postgres-cooldown.store.js';
import { PostgresRecipientIndexStore } from './postgres-recipient-index.store.js';
import { PostgresAuditSink } from './postgres-audit.sink.js';
import { runMigrations, RunMigrationsOptions } from './migration-runner.js';

export interface CreatePostgresStoresOptions extends RunMigrationsOptions {
  connectionString?: string;
  pool?: Pool;
  poolConfig?: PoolConfig;
}

export interface PostgresStores {
  verify: PostgresVerifyStore;
  abuse: PostgresAbuseStore;
  rateLimit: PostgresRateLimitStore;
  cooldown: PostgresCooldownStore;
  recipientIndex: PostgresRecipientIndexStore;
  audit: PostgresAuditSink;
  /** The shared pg.Pool. Use this to close cleanly on shutdown. */
  pool: Pool;
}

/**
 * Construct all five Postgres stores against a shared connection pool
 * and run pending migrations (idempotent, advisory-locked). Returns the
 * stores plus the pool so you can close it on shutdown.
 *
 * @example
 * const { verify, abuse, rateLimit, cooldown, recipientIndex } =
 *   await createPostgresStores({ connectionString: process.env.DATABASE_URL });
 */
export async function createPostgresStores(
  opts: CreatePostgresStoresOptions,
): Promise<PostgresStores> {
  let pool: Pool;
  if (opts.pool) {
    pool = opts.pool;
  } else if (opts.connectionString || opts.poolConfig) {
    pool = new Pool(
      opts.poolConfig ?? { connectionString: opts.connectionString },
    );
  } else {
    throw new Error(
      'createPostgresStores: provide one of {connectionString, pool, poolConfig}',
    );
  }

  // A pool created here is ours to close if startup fails; otherwise its
  // connections stay open until the process exits (#65). A pool the caller
  // passed in stays the caller's. The migration error is the one reported.
  const createdHere = !opts.pool;
  try {
    await runMigrations(pool, { skipSchemaSetup: opts.skipSchemaSetup });
  } catch (err) {
    if (createdHere) await pool.end().catch(() => undefined);
    throw err;
  }

  return {
    verify: new PostgresVerifyStore({ pool }),
    abuse: new PostgresAbuseStore({ pool }),
    rateLimit: new PostgresRateLimitStore({ pool }),
    cooldown: new PostgresCooldownStore({ pool }),
    recipientIndex: new PostgresRecipientIndexStore({ pool }),
    audit: new PostgresAuditSink({ pool }),
    pool,
  };
}
