/**
 * Adapter smoke. Exercises every store interface (VerifyStore, AbuseStore,
 * RateLimitStore, CooldownStore, PhoneIndexStore) against every backend
 * (Postgres, Mongo, Redis where applicable) and asserts the documented
 * contract that the core interfaces promise.
 *
 * Usage:
 *
 *   pnpm test:adapters
 *
 * which is shorthand for:
 *
 *   docker compose -f scripts/docker-compose.smoke.yml up -d --wait
 *   pnpm build
 *   node scripts/smoke-adapters.mjs
 *   docker compose -f scripts/docker-compose.smoke.yml down -v
 */
import Redis from 'ioredis';
import { createPostgresStores } from '@jadedm/nestjs-verify-postgres';
import { createMongoStores } from '@jadedm/nestjs-verify-mongo';
import { createRedisStores } from '@jadedm/nestjs-verify-redis';

const PG_URL = process.env.SMOKE_PG_URL ?? 'postgres://postgres:test@localhost:55432/verify';
const MG_URL = process.env.SMOKE_MG_URL ?? 'mongodb://localhost:57017';
const MG_DB  = process.env.SMOKE_MG_DB  ?? 'verify_smoke';
const REDIS_HOST = process.env.SMOKE_REDIS_HOST ?? 'localhost';
const REDIS_PORT = Number(process.env.SMOKE_REDIS_PORT ?? 56379);

const assert = (cond, msg) => {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
  console.log('  ok:', msg);
};

function recordFixture(sid, overrides = {}) {
  const now = new Date();
  return {
    sid,
    phone: '+14155552671',
    channel: 'sms',
    codeHash: 'deadbeef',
    salt: 'salt',
    attempts: 0,
    maxAttempts: 3,
    status: 'pending',
    createdAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
    ...overrides,
  };
}

async function exerciseVerifyStore(name, verify) {
  console.log(`\n--- ${name} VerifyStore ---`);
  const v1 = recordFixture('vr_smoke_1');
  await verify.create(v1);
  const got = await verify.get(v1.sid);
  assert(got?.sid === v1.sid && got?.status === 'pending', 'create + get round-trips');
  assert(got?.attempts === 0, 'attempts default 0');
  assert((await verify.get('vr_missing')) === null, 'get returns null for missing sid');

  const r1 = await verify.incrementAttempts(v1.sid);
  assert(r1.outcome === 'incremented', 'first increment -> incremented');
  assert(r1.record?.attempts === 1, 'attempts now 1');

  const rNF = await verify.incrementAttempts('vr_missing');
  assert(rNF.outcome === 'not-found', 'increment on missing -> not-found');

  const v2 = recordFixture('vr_smoke_2', { attempts: 2, maxAttempts: 3 });
  await verify.create(v2);
  const r2 = await verify.incrementAttempts(v2.sid);
  assert(r2.outcome === 'locked-out', 'increment at max -> locked-out');
  assert(r2.record?.status === 'canceled', 'status flipped to canceled atomically');

  const v3 = recordFixture('vr_smoke_3');
  await verify.create(v3);
  assert((await verify.markStatus(v3.sid, 'approved')) === true, 'markStatus pending -> approved');
  assert((await verify.markStatus(v3.sid, 'canceled')) === false, 'second markStatus returns false');

  const rNP = await verify.incrementAttempts(v3.sid);
  assert(rNP.outcome === 'not-pending', 'increment on terminal -> not-pending');

  await verify.delete(v1.sid);
  assert((await verify.get(v1.sid)) === null, 'delete works');
}

async function exerciseAbuseStore(name, abuse) {
  console.log(`\n--- ${name} AbuseStore ---`);
  await abuse.recordSendAttempt({ sid: 'a1', phone: '+15555550001', ip: '203.0.113.5', channel: 'sms', provider: 'mock', success: true });
  await abuse.recordSendAttempt({ sid: 'a2', phone: '+15555550002', ip: '203.0.113.5', channel: 'sms', provider: 'mock', success: true });
  await abuse.recordSendAttempt({ sid: 'a3', phone: '+15555550001', ip: '203.0.113.6', channel: 'sms', provider: 'mock', success: false });

  assert((await abuse.countAttemptsByIp('203.0.113.5', 60_000)) === 2, 'countAttemptsByIp returns 2');
  assert((await abuse.countAttemptsByPhone('+15555550001', 60_000)) === 2, 'countAttemptsByPhone returns 2');
  assert((await abuse.countDistinctPhonesByIp('203.0.113.5', 60_000)) === 2, 'countDistinctPhonesByIp returns 2');
}

async function exerciseRateLimitStore(name, rateLimit) {
  console.log(`\n--- ${name} RateLimitStore ---`);
  const a = await rateLimit.hit(`rl:${name}:a`, 3, 60);
  assert(a.count === 1 && !a.exceeded, 'first hit: not exceeded');
  await rateLimit.hit(`rl:${name}:a`, 3, 60);
  await rateLimit.hit(`rl:${name}:a`, 3, 60);
  const fourth = await rateLimit.hit(`rl:${name}:a`, 3, 60);
  assert(fourth.count === 4 && fourth.exceeded, 'fourth hit: exceeded');
  assert(fourth.resetAt > Date.now(), 'resetAt in the future');

  const b = await rateLimit.hit(`rl:${name}:b`, 3, 60);
  assert(b.count === 1, 'counters are isolated by key');
}

async function exerciseCooldownStore(name, cooldown) {
  console.log(`\n--- ${name} CooldownStore ---`);
  assert((await cooldown.remaining(`cd:${name}:unknown`)) === 0, 'unknown key -> 0 ms');
  await cooldown.start(`cd:${name}:k`, 60);
  const ms = await cooldown.remaining(`cd:${name}:k`);
  assert(ms > 0 && ms <= 60_000, `remaining in (0, 60000], got ${ms}`);
}

async function exercisePhoneIndexStore(name, phoneIndex) {
  console.log(`\n--- ${name} PhoneIndexStore ---`);
  await phoneIndex.set(`idx:${name}:+91`, 'vr_x', 60);
  assert((await phoneIndex.get(`idx:${name}:+91`)) === 'vr_x', 'set/get round trip');
  await phoneIndex.delete(`idx:${name}:+91`);
  assert((await phoneIndex.get(`idx:${name}:+91`)) === null, 'delete clears entry');
}

async function exerciseAuditSink(name, audit) {
  console.log(`\n--- ${name} AuditSink ---`);
  const ts = new Date();
  await audit.record({
    type: 'verification_started',
    sid: `audit_${name}_1`,
    phoneRedacted: '+91***10',
    ip: '203.0.113.7',
    channel: 'sms',
    ts,
  });
  await audit.record({
    type: 'code_dispatched',
    sid: `audit_${name}_1`,
    phoneRedacted: '+91***10',
    ip: '203.0.113.7',
    channel: 'sms',
    provider: 'mock',
    ts,
    meta: { latencyMs: 12 },
  });
  // No public read API on the sink interface; just assert no throw on insert.
  console.log('  ok: recorded 2 events without error');
}

async function main() {
  // ---- Postgres: all 5 stores ----
  console.log('=== Postgres ===');
  const pg = await createPostgresStores({ connectionString: PG_URL });
  await exerciseVerifyStore('Postgres', pg.verify);
  await exerciseAbuseStore('Postgres', pg.abuse);
  await exerciseRateLimitStore('Postgres', pg.rateLimit);
  await exerciseCooldownStore('Postgres', pg.cooldown);
  await exercisePhoneIndexStore('Postgres', pg.phoneIndex);
  await exerciseAuditSink('Postgres', pg.audit);
  await pg.pool.end();

  // ---- Mongo: all 5 stores ----
  console.log('\n=== Mongo ===');
  const mg = await createMongoStores({ uri: MG_URL, databaseName: MG_DB });
  await exerciseVerifyStore('Mongo', mg.verify);
  await exerciseAbuseStore('Mongo', mg.abuse);
  await exerciseRateLimitStore('Mongo', mg.rateLimit);
  await exerciseCooldownStore('Mongo', mg.cooldown);
  await exercisePhoneIndexStore('Mongo', mg.phoneIndex);
  await exerciseAuditSink('Mongo', mg.audit);
  await mg.close?.();

  // ---- Redis: 3 ephemeral stores ----
  console.log('\n=== Redis ===');
  const client = new Redis({ host: REDIS_HOST, port: REDIS_PORT });
  await client.flushall();
  const r = createRedisStores({ client });
  await exerciseRateLimitStore('Redis', r.rateLimit);
  await exerciseCooldownStore('Redis', r.cooldown);
  await exercisePhoneIndexStore('Redis', r.phoneIndex);
  await client.quit();

  console.log('\nALL ADAPTER CONTRACTS VERIFIED');
  process.exit(0);
}

main().catch((e) => { console.error('FAIL with exception:', e); process.exit(1); });
