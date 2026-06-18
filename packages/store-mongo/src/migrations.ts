import type { Db } from 'mongodb';

export interface MongoMigration {
  version: number;
  description: string;
  /** Imperative function: receives the Db and applies the migration. */
  apply: (db: Db) => Promise<void>;
}

export const PACKAGE_NAME = '@jadedm/nestjs-verify-mongo';

export const MIGRATIONS: MongoMigration[] = [
  {
    version: 1,
    description:
      'create indexes (TTL on verifications, abuse log retention, rate limits, cooldowns, phone index)',
    apply: async (db) => {
      const verifications = db.collection('verifications');
      const abuse = db.collection('verify_abuse_log');
      const rateLimits = db.collection('verify_rate_limits');
      const cooldowns = db.collection('verify_cooldowns');
      const phoneIndex = db.collection('verify_phone_index');

      await Promise.all([
        verifications.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        verifications.createIndex({ phone: 1, status: 1, createdAt: -1 }),

        abuse.createIndex({ ts: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 }),
        abuse.createIndex({ ip: 1, ts: -1 }),
        abuse.createIndex({ phone: 1, ts: -1 }),

        rateLimits.createIndex({ resetAt: 1 }, { expireAfterSeconds: 0 }),

        cooldowns.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),

        phoneIndex.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      ]);
    },
  },
];
