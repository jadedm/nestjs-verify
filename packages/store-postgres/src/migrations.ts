export interface Migration {
  version: number;
  description: string;
  sql: string;
}

export const PACKAGE_NAME = '@jadedm/nestjs-verify-postgres';

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'initial schema (verifications, abuse log, rate limits, cooldowns, phone index)',
    sql: `
      CREATE TABLE IF NOT EXISTS verifications (
        sid TEXT PRIMARY KEY,
        phone TEXT NOT NULL,
        channel TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL,
        status TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS verifications_phone_status_idx
        ON verifications (phone, status);
      CREATE INDEX IF NOT EXISTS verifications_expires_at_idx
        ON verifications (expires_at);

      CREATE TABLE IF NOT EXISTS verify_abuse_log (
        id BIGSERIAL PRIMARY KEY,
        sid TEXT NOT NULL,
        phone TEXT NOT NULL,
        ip TEXT,
        channel TEXT NOT NULL,
        provider TEXT NOT NULL,
        success BOOLEAN NOT NULL,
        error_code TEXT,
        ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS verify_abuse_log_ip_ts_idx
        ON verify_abuse_log (ip, ts DESC);
      CREATE INDEX IF NOT EXISTS verify_abuse_log_phone_ts_idx
        ON verify_abuse_log (phone, ts DESC);

      CREATE TABLE IF NOT EXISTS verify_rate_limits (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        reset_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS verify_rate_limits_reset_at_idx
        ON verify_rate_limits (reset_at);

      CREATE TABLE IF NOT EXISTS verify_cooldowns (
        key TEXT PRIMARY KEY,
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS verify_cooldowns_expires_at_idx
        ON verify_cooldowns (expires_at);

      CREATE TABLE IF NOT EXISTS verify_phone_index (
        phone TEXT PRIMARY KEY,
        sid TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS verify_phone_index_expires_at_idx
        ON verify_phone_index (expires_at);
    `,
  },
  {
    version: 2,
    description: 'audit log table for AuditSink events',
    sql: `
      CREATE TABLE IF NOT EXISTS verify_audit_log (
        id BIGSERIAL PRIMARY KEY,
        type TEXT NOT NULL,
        sid TEXT,
        phone_redacted TEXT NOT NULL,
        ip TEXT,
        channel TEXT NOT NULL,
        provider TEXT,
        outcome TEXT,
        ts TIMESTAMPTZ NOT NULL,
        meta JSONB
      );
      CREATE INDEX IF NOT EXISTS verify_audit_log_ts_idx
        ON verify_audit_log (ts DESC);
      CREATE INDEX IF NOT EXISTS verify_audit_log_sid_idx
        ON verify_audit_log (sid);
      CREATE INDEX IF NOT EXISTS verify_audit_log_type_ts_idx
        ON verify_audit_log (type, ts DESC);
    `,
  },
];
