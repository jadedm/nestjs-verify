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
 *
 * SMOKE_BACKENDS picks the backends (default "postgres,mongo,redis"). Each
 * backend's packages are imported only when it runs, so the script also runs
 * from a project that has only core and one store installed
 * (scripts/smoke-mongo-drivers.mjs runs it that way per mongodb driver).
 */
import 'reflect-metadata';
import { MemoryVerifyStore, MockEmailProvider, VerifyService } from '@jadedm/nestjs-verify';

const BACKENDS = (process.env.SMOKE_BACKENDS ?? 'postgres,mongo,redis').split(',').map((b) => b.trim());
const KNOWN = ['postgres', 'mongo', 'redis'];
const unknownBackends = BACKENDS.filter((b) => !KNOWN.includes(b));
if (unknownBackends.length > 0 || BACKENDS.length === 0) {
  console.error(`SMOKE_BACKENDS must name some of ${KNOWN.join(', ')}; got "${process.env.SMOKE_BACKENDS}"`);
  process.exit(2);
}

const PG_URL = process.env.SMOKE_PG_URL ?? 'postgres://postgres:test@localhost:55432/verify';
const MG_URL = process.env.SMOKE_MG_URL ?? 'mongodb://localhost:57017';
const MG_DB  = process.env.SMOKE_MG_DB  ?? 'verify_smoke';
const REDIS_HOST = process.env.SMOKE_REDIS_HOST ?? 'localhost';
const REDIS_PORT = Number(process.env.SMOKE_REDIS_PORT ?? 56379);

const RUN = Date.now().toString(36);
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

  // reserveAttempt: at most maxAttempts of many simultaneous reservations.
  const v4 = recordFixture(`vr_reserve_${RUN}`, { attempts: 0, maxAttempts: 3 });
  await verify.create(v4);
  const many = (await Promise.all(Array.from({ length: 10 }, () => verify.reserveAttempt(v4.sid)))).map((r) => r.outcome);
  assert(many.filter((o) => o === 'reserved').length === 3, `exactly 3 of 10 simultaneous reservations succeed, got ${many.join(',')}`);
  assert(many.filter((o) => o === 'exhausted').length === 7, 'the other 7 are exhausted');
  const after = await verify.get(v4.sid);
  assert(after.attempts === 3 && after.status === 'pending', `reserveAttempt never changes the status, got ${after.attempts}/${after.status}`);
  assert((await verify.reserveAttempt('vr_missing')).outcome === 'not-found', 'reserve on unknown sid -> not-found');
  assert((await verify.reserveAttempt(v3.sid)).outcome === 'not-pending', 'reserve on a finished record -> not-pending');
  const v5 = recordFixture(`vr_expired_${RUN}`, { attempts: 0, maxAttempts: 3, expiresAt: new Date(Date.now() - 1_000) });
  await verify.create(v5);
  const rExp = await verify.reserveAttempt(v5.sid);
  assert(rExp.outcome === 'expired' && rExp.record.attempts === 0, `reserve on an expired record -> expired, attempts untouched, got ${rExp.outcome}/${rExp.record?.attempts}`);

  // A refusal is named by the database clock that made it, whatever this
  // process's clock says (#105). Fixtures are written before the skew.
  const realNow = Date.now();
  const v6 = recordFixture(`vr_dbexpired_${RUN}`, { attempts: 0, maxAttempts: 3, expiresAt: new Date(realNow - 1_000) });
  const v7 = recordFixture(`vr_dbspent_${RUN}`, { attempts: 3, maxAttempts: 3, expiresAt: new Date(realNow + 60_000) });
  await verify.create(v6);
  await verify.create(v7);
  const skew = (ms) => { Date.now = () => realNow + ms; };
  const realDateNow = Date.now;
  try {
    skew(-3_600_000);
    const behind = (await verify.reserveAttempt(v6.sid)).outcome;
    skew(3_600_000);
    const ahead = (await verify.reserveAttempt(v7.sid)).outcome;
    Date.now = realDateNow;
    assert(behind === 'expired', `expired by the database clock while the app clock is an hour behind -> expired, got ${behind}`);
    assert(ahead === 'exhausted', `spent but unexpired while the app clock is an hour ahead -> exhausted, got ${ahead}`);
  } finally {
    Date.now = realDateNow;
  }
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

  // claim and release (#13). Keys carry a per-run suffix so a rerun against
  // the same database does not meet its own earlier claims.
  const k = (suffix) => `cd:${name}:${RUN}:${suffix}`;
  const many = await Promise.all(Array.from({ length: 10 }, (_, i) => cooldown.claim(k('race'), 60, `h${i}`)));
  assert(many.filter((r) => r === 0).length === 1, `exactly one of 10 simultaneous claims wins, got ${many.join(',')}`);
  assert(many.filter((r) => r > 0).length === 9, 'the other nine get the remaining ms');

  assert((await cooldown.claim(k('renew'), 1, 'a')) === 0, 'claim a free key');
  assert((await cooldown.claim(k('renew'), 60, 'a')) === 0, 'the same holder renews');
  assert((await cooldown.remaining(k('renew'))) > 1_000, 'renewal extended the claim');
  assert((await cooldown.claim(k('renew'), 60, 'b')) > 0, 'another holder is refused');

  await cooldown.release(k('renew'), 'b');
  assert((await cooldown.claim(k('renew'), 60, 'b')) > 0, 'release by another holder does nothing');
  await cooldown.release(k('renew'), 'a');
  assert((await cooldown.claim(k('renew'), 60, 'b')) === 0, 'release by the holder frees it');

  await cooldown.claim(k('started'), 60, 'a');
  await cooldown.start(k('started'), 60);
  await cooldown.release(k('started'), 'a');
  assert((await cooldown.remaining(k('started'))) > 0, 'release cannot end a cooldown started after the claim');
  assert((await cooldown.claim(k('started'), 60, 'a')) > 0, 'a started cooldown is not claimable by the old holder');

  assert((await cooldown.claim(k('expiry'), 1, 'a')) === 0, 'claim for 1 s');
  await new Promise((r) => setTimeout(r, 1_200));
  assert((await cooldown.claim(k('expiry'), 60, 'b')) === 0, 'an expired claim can be taken');
}

async function exercisePhoneIndexStore(name, phoneIndex) {
  console.log(`\n--- ${name} PhoneIndexStore ---`);
  await phoneIndex.set(`idx:${name}:+91`, 'vr_x', 60);
  assert((await phoneIndex.get(`idx:${name}:+91`)) === 'vr_x', 'set/get round trip');
  await phoneIndex.delete(`idx:${name}:+91`);
  assert((await phoneIndex.get(`idx:${name}:+91`)) === null, 'delete clears entry');

  // deleteIfMatches (#9): removes the entry only while it holds the sid.
  const key = `idx:${name}:${RUN}:cmp`;
  await phoneIndex.set(key, 'vr_a', 60);
  await phoneIndex.deleteIfMatches(key, 'vr_b');
  assert((await phoneIndex.get(key)) === 'vr_a', 'deleteIfMatches with another sid keeps the entry');
  await phoneIndex.deleteIfMatches(key, 'vr_a');
  assert((await phoneIndex.get(key)) === null, 'deleteIfMatches with the same sid removes it');
  await phoneIndex.deleteIfMatches(key, 'vr_a');
  assert((await phoneIndex.get(key)) === null, 'deleteIfMatches on a missing entry is a no-op');
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

// A whole email verification through VerifyService on the given stores: the
// address is the store key, so every adapter must hold it as it holds a phone.
async function exerciseEmailFlow(name, stores) {
  console.log(`\n--- ${name} email verification through VerifyService ---`);
  const sent = [];
  const service = new VerifyService({
    email: { provider: new MockEmailProvider({ logToConsole: false, onSend: (p) => sent.push(p) }) },
    stores,
    code: { fixedCode: '424242' },
    attempts: { max: 2 },
  });
  const tag = name.toLowerCase();
  const started = await service.start({ to: `Smoke.${tag}@Example.com`, channel: 'email', ip: '203.0.113.9' });
  assert(started.channel === 'email' && sent.length === 1 && sent[0].text.includes('424242'), 'start by email sends the code');
  const approved = await service.check({ to: `Smoke.${tag}@example.COM`, code: '424242' });
  assert(approved.state === 'approved', 'check approves the code; domain case folded');

  const locked = `lock.${tag}@example.com`;
  await service.start({ to: locked, channel: 'email' });
  await service.check({ to: locked, code: '000000' });
  assert((await service.check({ to: locked, code: '000000' })).state === 'canceled', 'wrong codes lock out');
  const again = await service.start({ to: locked, channel: 'email' }).catch((e) => e);
  assert(again?.code === 'COOLDOWN_ACTIVE', 'cooldown applies to the address');

  // Simultaneous starts for one address: one sends, the others are refused (#13).
  const raced = `race.${tag}.${RUN}@example.com`;
  const before = sent.length;
  const results = await Promise.all(
    Array.from({ length: 5 }, () => service.start({ to: raced, channel: 'email' }).then(() => 'ok', (e) => e?.code ?? e?.message)),
  );
  assert(results.filter((r) => r === 'ok').length === 1, `one of 5 simultaneous starts succeeds, got ${results.join(',')}`);
  assert(results.filter((r) => r === 'COOLDOWN_ACTIVE').length === 4, 'the other four get COOLDOWN_ACTIVE');
  assert(sent.length - before === 1, 'one code sent');

  // A burst of simultaneous wrong checks spends exactly attempts.max (2)
  // attempts: the one that spends the last locks the record and the rest are
  // refused without a comparison. The one with an attempt left answers pending
  // only if it answers before the lockout lands, so at most one does (#105).
  const burst = `burst.${tag}.${RUN}@example.com`;
  const { sid: burstSid } = await service.start({ to: burst, channel: 'email' });
  const answers = await Promise.all(
    Array.from({ length: 20 }, (_, i) => service.check({ to: burst, code: String(100000 + i) }).then((r) => r.state, (e) => e?.code ?? e?.message)),
  );
  const burstRecord = await stores.verify.get(burstSid);
  assert(burstRecord.attempts === 2 && burstRecord.status === 'canceled', `a burst spends exactly 2 attempts, got ${burstRecord.attempts}/${burstRecord.status}`);
  assert(answers.filter((a) => a === 'pending').length <= 1, `at most one wrong guess answers pending, got ${answers.join(',')}`);
  assert(answers.every((a) => a === 'pending' || a === 'canceled'), `every other guess answers canceled, got ${answers.join(',')}`);
}

// This process's clock set the deadline, so the service holds it even while
// the database still finds the code valid: the stricter clock wins (#105).
// Mongo is not run here: its phone index judges expiry by this process's
// clock, so the lookup would fail before the check reached the deadline.
async function exerciseServerClockExpiry(name, stores) {
  console.log(`\n--- ${name} check holds the deadline the server set ---`);
  const service = new VerifyService({
    email: { provider: new MockEmailProvider({ logToConsole: false }) },
    stores,
    code: { fixedCode: '424242', ttlSeconds: 60 },
    attempts: { max: 3, cooldownSeconds: 0 },
  });
  const to = `clock.${name.toLowerCase()}.${RUN}@example.com`;
  await service.start({ to, channel: 'email' });
  const realDateNow = Date.now;
  const realNow = realDateNow();
  let answer;
  try {
    Date.now = () => realNow + 120_000;
    answer = await service.check({ to, code: '000000' }).then((r) => r.state, (e) => e?.code ?? e?.message);
  } finally {
    Date.now = realDateNow;
  }
  assert(answer === 'CODE_EXPIRED', `a code past its deadline by the server clock, valid by the database clock -> CODE_EXPIRED, got ${answer}`);
}

// A second start must wait while another instance holds the migration lock.
async function exerciseMongoMigrationLock(createMongoStores, mongodb) {
  console.log('\n--- Mongo migration lock ---');
  const client = await mongodb.MongoClient.connect(MG_URL);
  const db = client.db(`${MG_DB}_lock_${RUN}`);
  await createMongoStores({ db });
  const meta = db.collection('verify_schema_versions');
  await meta.updateOne({ _id: '@jadedm/nestjs-verify-mongo' }, { $set: { lockUntil: new Date(Date.now() + 120_000) } });
  const second = createMongoStores({ db }).then(() => 'acquired', (e) => `error: ${e.message}`);
  const first = await Promise.race([second, new Promise((r) => setTimeout(() => r('waited'), 2_500))]);
  assert(first === 'waited', `a held migration lock makes a second start wait, got ${first}`);
  await meta.updateOne({ _id: '@jadedm/nestjs-verify-mongo' }, { $unset: { lockUntil: '' } });
  assert((await second) === 'acquired', 'the second start goes ahead once the lock is free');
  await db.dropDatabase();
  await client.close();
}

async function main() {
  if (BACKENDS.includes('postgres')) await smokePostgres();
  if (BACKENDS.includes('mongo')) await smokeMongo();
  if (BACKENDS.includes('redis')) await smokeRedis();
  console.log(`\nALL ADAPTER CONTRACTS VERIFIED (${BACKENDS.join(', ')})`);
  process.exit(0);
}

async function smokePostgres() {
  const { createPostgresStores } = await import('@jadedm/nestjs-verify-postgres');
  // ---- Postgres: all 5 stores ----
  console.log('=== Postgres ===');
  const pg = await createPostgresStores({ connectionString: PG_URL });
  await exerciseVerifyStore('Postgres', pg.verify);
  await exerciseAbuseStore('Postgres', pg.abuse);
  await exerciseRateLimitStore('Postgres', pg.rateLimit);
  await exerciseCooldownStore('Postgres', pg.cooldown);
  await exercisePhoneIndexStore('Postgres', pg.phoneIndex);
  await exerciseAuditSink('Postgres', pg.audit);
  await exerciseEmailFlow('Postgres', pg);
  await exerciseServerClockExpiry('Postgres', pg);
  await pg.pool.end();
}

async function smokeMongo() {
  const { createMongoStores } = await import('@jadedm/nestjs-verify-mongo');
  const mongodb = await import('mongodb');
  // ---- Mongo: all 5 stores ----
  console.log('\n=== Mongo ===');
  const mg = await createMongoStores({ uri: MG_URL, databaseName: MG_DB });
  await exerciseVerifyStore('Mongo', mg.verify);
  await exerciseAbuseStore('Mongo', mg.abuse);
  await exerciseRateLimitStore('Mongo', mg.rateLimit);
  await exerciseCooldownStore('Mongo', mg.cooldown);
  await exercisePhoneIndexStore('Mongo', mg.phoneIndex);
  await exerciseAuditSink('Mongo', mg.audit);
  await exerciseEmailFlow('Mongo', mg);
  await mg.close?.();
  await exerciseMongoMigrationLock(createMongoStores, mongodb);
}

async function smokeRedis() {
  const { default: Redis } = await import('ioredis');
  const { createRedisStores } = await import('@jadedm/nestjs-verify-redis');
  // ---- Redis: 3 ephemeral stores ----
  console.log('\n=== Redis ===');
  const client = new Redis({ host: REDIS_HOST, port: REDIS_PORT });
  await client.flushall();
  const r = createRedisStores({ client });
  await exerciseRateLimitStore('Redis', r.rateLimit);
  await exerciseCooldownStore('Redis', r.cooldown);
  await exercisePhoneIndexStore('Redis', r.phoneIndex);
  await exerciseEmailFlow('Redis', { ...r, verify: new MemoryVerifyStore() });
  await client.quit();
}

main().catch((e) => { console.error('FAIL with exception:', e); process.exit(1); });
