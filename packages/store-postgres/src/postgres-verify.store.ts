import type {
  IncrementResult,
  VerificationRecord,
  VerificationStatus,
  VerifyStore,
} from '@jadedm/nestjs-verify';
import { Pool, PoolConfig } from 'pg';

export interface PostgresVerifyStoreOptions {
  connectionString?: string;
  pool?: Pool;
  poolConfig?: PoolConfig;
  tableName?: string;
}

interface Row {
  sid: string;
  phone: string;
  channel: string;
  code_hash: string;
  salt: string;
  attempts: number;
  max_attempts: number;
  status: string;
  created_at: Date;
  expires_at: Date;
}

export class PostgresVerifyStore implements VerifyStore {
  private readonly pool: Pool;
  private readonly table: string;

  constructor(opts: PostgresVerifyStoreOptions) {
    if (opts.pool) {
      this.pool = opts.pool;
    } else if (opts.connectionString || opts.poolConfig) {
      this.pool = new Pool(
        opts.poolConfig ?? { connectionString: opts.connectionString },
      );
    } else {
      throw new Error(
        'PostgresVerifyStore: provide one of {connectionString, pool, poolConfig}',
      );
    }
    this.table = opts.tableName ?? 'verifications';
  }

  async create(v: VerificationRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.table}
        (sid, phone, channel, code_hash, salt, attempts, max_attempts, status, created_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        v.sid,
        v.phone,
        v.channel,
        v.codeHash,
        v.salt,
        v.attempts,
        v.maxAttempts,
        v.status,
        v.createdAt,
        v.expiresAt,
      ],
    );
  }

  async get(sid: string): Promise<VerificationRecord | null> {
    const { rows } = await this.pool.query<Row>(
      `SELECT * FROM ${this.table} WHERE sid = $1`,
      [sid],
    );
    return rows[0] ? this.fromRow(rows[0]) : null;
  }

  async incrementAttempts(sid: string): Promise<IncrementResult> {
    // Atomic: increment AND conditionally flip status to 'canceled' if the
    // new count reaches max_attempts. Single round-trip, RETURNING the new
    // row so the caller knows the outcome without re-reading.
    const { rows } = await this.pool.query<Row>(
      `UPDATE ${this.table}
       SET attempts = attempts + 1,
           status = CASE
             WHEN attempts + 1 >= max_attempts THEN 'canceled'
             ELSE status
           END
       WHERE sid = $1 AND status = 'pending'
       RETURNING *`,
      [sid],
    );
    if (rows[0]) {
      const record = this.fromRow(rows[0]);
      return {
        record,
        outcome: record.status === 'canceled' ? 'locked-out' : 'incremented',
      };
    }
    // The UPDATE didn't match — either no such sid, or status != 'pending'.
    const existing = await this.get(sid);
    if (!existing) return { record: null, outcome: 'not-found' };
    return { record: existing, outcome: 'not-pending' };
  }

  async markStatus(
    sid: string,
    status: Exclude<VerificationStatus, 'pending'>,
  ): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE ${this.table} SET status = $2
       WHERE sid = $1 AND status = 'pending'`,
      [sid, status],
    );
    return (res.rowCount ?? 0) === 1;
  }

  async delete(sid: string): Promise<void> {
    await this.pool.query(`DELETE FROM ${this.table} WHERE sid = $1`, [sid]);
  }

  private fromRow(r: Row): VerificationRecord {
    return {
      sid: r.sid,
      phone: r.phone,
      channel: r.channel as VerificationRecord['channel'],
      codeHash: r.code_hash,
      salt: r.salt,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      status: r.status as VerificationStatus,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
    };
  }
}
