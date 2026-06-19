import type { AuditEvent, AuditSink } from '@jadedm/nestjs-verify';
import { Pool, PoolConfig } from 'pg';

export interface PostgresAuditSinkOptions {
  connectionString?: string;
  pool?: Pool;
  poolConfig?: PoolConfig;
  tableName?: string;
}

/**
 * Durable audit sink against Postgres. Writes one row per event into
 * `verify_audit_log` (created by migration 002). Meta is stored as JSONB
 * for ad-hoc queries.
 */
export class PostgresAuditSink implements AuditSink {
  private readonly pool: Pool;
  private readonly table: string;

  constructor(opts: PostgresAuditSinkOptions) {
    if (opts.pool) {
      this.pool = opts.pool;
    } else if (opts.connectionString || opts.poolConfig) {
      this.pool = new Pool(
        opts.poolConfig ?? { connectionString: opts.connectionString },
      );
    } else {
      throw new Error(
        'PostgresAuditSink: provide one of {connectionString, pool, poolConfig}',
      );
    }
    this.table = opts.tableName ?? 'verify_audit_log';
  }

  async record(event: AuditEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.table}
        (type, sid, phone_redacted, ip, channel, provider, outcome, ts, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        event.type,
        event.sid ?? null,
        event.phoneRedacted,
        event.ip ?? null,
        event.channel,
        event.provider ?? null,
        event.outcome ?? null,
        event.ts,
        event.meta ? JSON.stringify(event.meta) : null,
      ],
    );
  }
}
