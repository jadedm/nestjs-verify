import type { PhoneIndexStore } from '@jadedm/nestjs-verify';
import { Pool, PoolConfig } from 'pg';

export interface PostgresPhoneIndexStoreOptions {
  connectionString?: string;
  pool?: Pool;
  poolConfig?: PoolConfig;
  tableName?: string;
}

export class PostgresPhoneIndexStore implements PhoneIndexStore {
  private readonly pool: Pool;
  private readonly table: string;

  constructor(opts: PostgresPhoneIndexStoreOptions) {
    if (opts.pool) {
      this.pool = opts.pool;
    } else if (opts.connectionString || opts.poolConfig) {
      this.pool = new Pool(
        opts.poolConfig ?? { connectionString: opts.connectionString },
      );
    } else {
      throw new Error(
        'PostgresPhoneIndexStore: provide one of {connectionString, pool, poolConfig}',
      );
    }
    this.table = opts.tableName ?? 'verify_phone_index';
  }

  async set(phone: string, sid: string, ttlSeconds: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.table} (phone, sid, expires_at)
       VALUES ($1, $2, NOW() + ($3 || ' seconds')::interval)
       ON CONFLICT (phone) DO UPDATE
       SET sid = EXCLUDED.sid, expires_at = EXCLUDED.expires_at`,
      [phone, sid, String(ttlSeconds)],
    );
  }

  async get(phone: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ sid: string }>(
      `SELECT sid FROM ${this.table}
       WHERE phone = $1 AND expires_at > NOW()`,
      [phone],
    );
    return rows[0]?.sid ?? null;
  }

  async delete(phone: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM ${this.table} WHERE phone = $1`,
      [phone],
    );
  }
}
