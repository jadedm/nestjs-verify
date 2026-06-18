import type {
  RateLimitHit,
  RateLimitStore,
} from '@jadedm/nestjs-verify';
import { Pool, PoolConfig } from 'pg';

export interface PostgresRateLimitStoreOptions {
  connectionString?: string;
  pool?: Pool;
  poolConfig?: PoolConfig;
  tableName?: string;
}

interface Row {
  count: number;
  reset_at: Date;
}

export class PostgresRateLimitStore implements RateLimitStore {
  private readonly pool: Pool;
  private readonly table: string;

  constructor(opts: PostgresRateLimitStoreOptions) {
    if (opts.pool) {
      this.pool = opts.pool;
    } else if (opts.connectionString || opts.poolConfig) {
      this.pool = new Pool(
        opts.poolConfig ?? { connectionString: opts.connectionString },
      );
    } else {
      throw new Error(
        'PostgresRateLimitStore: provide one of {connectionString, pool, poolConfig}',
      );
    }
    this.table = opts.tableName ?? 'verify_rate_limits';
  }

  async hit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitHit> {
    // Single atomic UPSERT. The CASE branches handle the "window has
    // already expired" path, resetting both the counter and the reset_at.
    // pg's row-level lock during the UPDATE makes this race-free across
    // concurrent callers.
    const { rows } = await this.pool.query<Row>(
      `INSERT INTO ${this.table} (key, count, reset_at)
       VALUES ($1, 1, NOW() + ($2 || ' seconds')::interval)
       ON CONFLICT (key) DO UPDATE
       SET
         count = CASE
           WHEN ${this.table}.reset_at <= NOW() THEN 1
           ELSE ${this.table}.count + 1
         END,
         reset_at = CASE
           WHEN ${this.table}.reset_at <= NOW() THEN NOW() + ($2 || ' seconds')::interval
           ELSE ${this.table}.reset_at
         END
       RETURNING count, reset_at`,
      [key, String(windowSeconds)],
    );
    const row = rows[0]!;
    return {
      count: row.count,
      limit,
      exceeded: row.count > limit,
      resetAt: row.reset_at.getTime(),
    };
  }
}
