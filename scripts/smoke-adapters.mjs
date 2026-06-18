/**
 * Adapter smoke test. Exercises the Postgres and Mongo store adapters
 * against real database containers and asserts the contract that the
 * core VerifyStore and AbuseStore interfaces promise.
 *
 * Usage:
 *
 *   docker compose -f scripts/docker-compose.smoke.yml up -d
 *   pnpm build
 *   node scripts/smoke-adapters.mjs
 *   docker compose -f scripts/docker-compose.smoke.yml down -v
 *
 * Or use the npm script:
 *
 *   pnpm test:adapters
 *
 * Exits 0 on success, 1 on any contract failure.
 */
import {
  PostgresVerifyStore,
  PostgresAbuseStore,
} from '@jadedm/nestjs-verify-postgres';
import {
  MongoVerifyStore,
  MongoAbuseStore,
} from '@jadedm/nestjs-verify-mongo';

const PG_URL = process.env.SMOKE_PG_URL ??
  'postgres://postgres:test@localhost:55432/verify';
const MG_URL = process.env.SMOKE_MG_URL ?? 'mongodb://localhost:57017';
const MG_DB = process.env.SMOKE_MG_DB ?? 'verify_smoke';

const assert = (cond, msg) => {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
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

async function exerciseStore(name, verify, abuse) {
  console.log(`\n=== ${name} ===`);

  const v1 = recordFixture('vr_smoke_1');
  await verify.create(v1);
  const got = await verify.get(v1.sid);
  assert(
    got?.sid === v1.sid && got?.status === 'pending',
    'create + get round-trips',
  );
  assert(got?.attempts === 0, 'attempts default 0');

  assert(
    (await verify.get('vr_missing')) === null,
    'get returns null for missing sid',
  );

  const r1 = await verify.incrementAttempts(v1.sid);
  assert(r1.outcome === 'incremented', 'first increment -> incremented');
  assert(r1.record?.attempts === 1, 'attempts now 1');

  const rNF = await verify.incrementAttempts('vr_missing');
  assert(rNF.outcome === 'not-found', 'increment on missing -> not-found');

  const v2 = recordFixture('vr_smoke_2', { attempts: 2, maxAttempts: 3 });
  await verify.create(v2);
  const r2 = await verify.incrementAttempts(v2.sid);
  assert(r2.outcome === 'locked-out', 'increment at max -> locked-out');
  assert(
    r2.record?.status === 'canceled',
    'status flipped to canceled atomically',
  );
  assert(r2.record?.attempts === 3, 'attempts at maxAttempts');

  const v3 = recordFixture('vr_smoke_3');
  await verify.create(v3);
  assert(
    (await verify.markStatus(v3.sid, 'approved')) === true,
    'markStatus pending -> approved',
  );
  assert(
    (await verify.markStatus(v3.sid, 'canceled')) === false,
    'second markStatus returns false',
  );

  const rNP = await verify.incrementAttempts(v3.sid);
  assert(rNP.outcome === 'not-pending', 'increment on terminal -> not-pending');

  await verify.delete(v1.sid);
  assert((await verify.get(v1.sid)) === null, 'delete works');

  await abuse.recordSendAttempt({
    sid: 'vr_smoke_a1', phone: '+15555550001', ip: '203.0.113.5',
    channel: 'sms', provider: 'mock', success: true,
  });
  await abuse.recordSendAttempt({
    sid: 'vr_smoke_a2', phone: '+15555550002', ip: '203.0.113.5',
    channel: 'sms', provider: 'mock', success: true,
  });
  await abuse.recordSendAttempt({
    sid: 'vr_smoke_a3', phone: '+15555550001', ip: '203.0.113.6',
    channel: 'sms', provider: 'mock', success: false,
  });

  const ip5 = await abuse.countAttemptsByIp('203.0.113.5', 60_000);
  assert(
    ip5 === 2,
    `countAttemptsByIp 203.0.113.5 -> ${ip5} (expected 2)`,
  );

  const phone1 = await abuse.countAttemptsByPhone('+15555550001', 60_000);
  assert(
    phone1 === 2,
    `countAttemptsByPhone +15555550001 -> ${phone1} (expected 2)`,
  );

  const distinct = await abuse.countDistinctPhonesByIp('203.0.113.5', 60_000);
  assert(
    distinct === 2,
    `countDistinctPhonesByIp 203.0.113.5 -> ${distinct} (expected 2)`,
  );
}

async function main() {
  const pgVerify = new PostgresVerifyStore({ connectionString: PG_URL });
  const pgAbuse = new PostgresAbuseStore({ connectionString: PG_URL });
  await pgVerify.ensureSchema();
  await pgAbuse.ensureSchema();
  await exerciseStore('Postgres', pgVerify, pgAbuse);

  const mgVerify = new MongoVerifyStore({ uri: MG_URL, databaseName: MG_DB });
  const mgAbuse = new MongoAbuseStore({ uri: MG_URL, databaseName: MG_DB });
  await mgVerify.ensureIndexes();
  await mgAbuse.ensureIndexes();
  await exerciseStore('Mongo', mgVerify, mgAbuse);

  await mgVerify.close?.();
  await mgAbuse.close?.();
  console.log('\nALL ADAPTER CONTRACTS VERIFIED');
  process.exit(0);
}

main().catch((e) => {
  console.error('FAIL with exception:', e);
  process.exit(1);
});
