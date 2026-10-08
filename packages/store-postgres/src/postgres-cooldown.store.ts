import type { CooldownStore } from '@jadedm/nestjs-verify';
import { Pool, PoolConfig } from 'pg';

export interface PostgresCooldownStoreOptions {
  connectionString?: string;
  pool?: Pool;
  poolConfig?: PoolConfig;
  tableName?: string;
}

export class PostgresCooldownStore implements CooldownStore {
  private readonly pool: Pool;
  private readonly table: string;

  constructor(opts: PostgresCooldownStoreOptions) {
    if (opts.pool) {
      this.pool = opts.pool;
    } else if (opts.connectionString || opts.poolConfig) {
      this.pool = new Pool(
        opts.poolConfig ?? { connectionString: opts.connectionString },
      );
    } else {
      throw new Error(
        'PostgresCooldownStore: provide one of {connectionString, pool, poolConfig}',
      );
    }
    this.table = opts.tableName ?? 'verify_cooldowns';
  }

  async remaining(key: string): Promise<number> {
    const { rows } = await this.pool.query<{ ms: string }>(
      `SELECT GREATEST(
         0,
         EXTRACT(EPOCH FROM (expires_at - NOW())) * 1000
       )::bigint::text AS ms
       FROM ${this.table}
       WHERE key = $1 AND expires_at > NOW()`,
      [key],
    );
    return Number(rows[0]?.ms ?? 0);
  }

  async start(key: string, seconds: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.table} (key, expires_at, holder)
       VALUES ($1, NOW() + ($2 || ' seconds')::interval, NULL)
       ON CONFLICT (key) DO UPDATE
       SET expires_at = EXCLUDED.expires_at, holder = NULL`,
      [key, String(seconds)],
    );
  }

  /**
   * One statement decides the holder. A concurrent claim on the same key
   * waits on the row lock, then re-checks the WHERE against the row the
   * winner committed, so only one of them updates or inserts.
   */
  async claim(key: string, seconds: number, holder: string): Promise<number> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO ${this.table} AS c (key, expires_at, holder)
       VALUES ($1, NOW() + ($2 || ' seconds')::interval, $3)
       ON CONFLICT (key) DO UPDATE
       SET expires_at = EXCLUDED.expires_at, holder = EXCLUDED.holder
       WHERE c.expires_at <= NOW() OR c.holder = EXCLUDED.holder`,
      [key, String(seconds), holder],
    );
    if (rowCount === 1) return 0;
    return Math.max(1, await this.remaining(key));
  }

  async release(key: string, holder: string): Promise<void> {
    await this.pool.query(`DELETE FROM ${this.table} WHERE key = $1 AND holder = $2`, [key, holder]);
  }
}
