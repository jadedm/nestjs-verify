import type { AbuseStore, SendAttempt } from '@jadedm/nestjs-verify';
import { Pool, PoolConfig } from 'pg';
import { ABUSE_TABLE_DDL } from './schema.js';

export interface PostgresAbuseStoreOptions {
  connectionString?: string;
  pool?: Pool;
  poolConfig?: PoolConfig;
  tableName?: string;
}

export class PostgresAbuseStore implements AbuseStore {
  private readonly pool: Pool;
  private readonly table: string;

  constructor(opts: PostgresAbuseStoreOptions) {
    if (opts.pool) {
      this.pool = opts.pool;
    } else if (opts.connectionString || opts.poolConfig) {
      this.pool = new Pool(
        opts.poolConfig ?? { connectionString: opts.connectionString },
      );
    } else {
      throw new Error(
        'PostgresAbuseStore: provide one of {connectionString, pool, poolConfig}',
      );
    }
    this.table = opts.tableName ?? 'verify_abuse_log';
  }

  async ensureSchema(): Promise<void> {
    await this.pool.query(ABUSE_TABLE_DDL);
  }

  async recordSendAttempt(s: SendAttempt): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.table}
        (sid, phone, ip, channel, provider, success, error_code, ts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8, NOW()))`,
      [
        s.sid,
        s.phone,
        s.ip ?? null,
        s.channel,
        s.provider,
        s.success,
        s.errorCode ?? null,
        s.ts ?? null,
      ],
    );
  }

  async countAttemptsByIp(ip: string, windowMs: number): Promise<number> {
    const { rows } = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM ${this.table}
       WHERE ip = $1 AND ts > NOW() - ($2::bigint || ' milliseconds')::interval`,
      [ip, String(windowMs)],
    );
    return Number(rows[0]?.count ?? 0);
  }

  async countAttemptsByPhone(
    phone: string,
    windowMs: number,
  ): Promise<number> {
    const { rows } = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM ${this.table}
       WHERE phone = $1 AND ts > NOW() - ($2::bigint || ' milliseconds')::interval`,
      [phone, String(windowMs)],
    );
    return Number(rows[0]?.count ?? 0);
  }

  async countDistinctPhonesByIp(
    ip: string,
    windowMs: number,
  ): Promise<number> {
    const { rows } = await this.pool.query<{ count: string }>(
      `SELECT COUNT(DISTINCT phone)::text AS count
       FROM ${this.table}
       WHERE ip = $1 AND ts > NOW() - ($2::bigint || ' milliseconds')::interval`,
      [ip, String(windowMs)],
    );
    return Number(rows[0]?.count ?? 0);
  }
}
