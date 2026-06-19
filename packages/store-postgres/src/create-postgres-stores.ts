import { Pool, PoolConfig } from 'pg';
import { PostgresVerifyStore } from './postgres-verify.store.js';
import { PostgresAbuseStore } from './postgres-abuse.store.js';
import { PostgresRateLimitStore } from './postgres-rate-limit.store.js';
import { PostgresCooldownStore } from './postgres-cooldown.store.js';
import { PostgresPhoneIndexStore } from './postgres-phone-index.store.js';
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
  phoneIndex: PostgresPhoneIndexStore;
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
 * const { verify, abuse, rateLimit, cooldown, phoneIndex } =
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

  await runMigrations(pool, { skipSchemaSetup: opts.skipSchemaSetup });

  return {
    verify: new PostgresVerifyStore({ pool }),
    abuse: new PostgresAbuseStore({ pool }),
    rateLimit: new PostgresRateLimitStore({ pool }),
    cooldown: new PostgresCooldownStore({ pool }),
    phoneIndex: new PostgresPhoneIndexStore({ pool }),
    audit: new PostgresAuditSink({ pool }),
    pool,
  };
}
