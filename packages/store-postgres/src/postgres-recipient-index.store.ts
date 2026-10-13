import type { PhoneIndexStore } from '@jadedm/nestjs-verify';
import { Pool, PoolConfig } from 'pg';

export interface PostgresRecipientIndexStoreOptions {
  connectionString?: string;
  pool?: Pool;
  poolConfig?: PoolConfig;
  tableName?: string;
}

// Implements the pre-0.9.0 type name: the core range this adapter supports
// starts before `RecipientIndexStore` existed (#8).
export class PostgresRecipientIndexStore implements PhoneIndexStore {
  private readonly pool: Pool;
  private readonly table: string;

  constructor(opts: PostgresRecipientIndexStoreOptions) {
    if (opts.pool) {
      this.pool = opts.pool;
    } else if (opts.connectionString || opts.poolConfig) {
      this.pool = new Pool(
        opts.poolConfig ?? { connectionString: opts.connectionString },
      );
    } else {
      throw new Error(
        'PostgresRecipientIndexStore: provide one of {connectionString, pool, poolConfig}',
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

  async deleteIfMatches(phone: string, sid: string): Promise<void> {
    await this.pool.query(`DELETE FROM ${this.table} WHERE phone = $1 AND sid = $2`, [phone, sid]);
  }
}

/** @deprecated Renamed to `PostgresRecipientIndexStore` in 0.9.0 (#8); removed in 1.0. */
export const PostgresPhoneIndexStore = PostgresRecipientIndexStore;
/** @deprecated Renamed to `PostgresRecipientIndexStore` in 0.9.0 (#8); removed in 1.0. */
export type PostgresPhoneIndexStore = PostgresRecipientIndexStore;
/** @deprecated Renamed to `PostgresRecipientIndexStoreOptions` in 0.9.0 (#8); removed in 1.0. */
export type PostgresPhoneIndexStoreOptions = PostgresRecipientIndexStoreOptions;
