export const VERIFICATIONS_TABLE_DDL = `
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
`;

export const ABUSE_TABLE_DDL = `
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
`;
