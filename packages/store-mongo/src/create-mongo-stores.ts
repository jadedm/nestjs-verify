import { Db, MongoClient, MongoClientOptions } from 'mongodb';
import { MongoVerifyStore } from './mongo-verify.store.js';
import { MongoAbuseStore } from './mongo-abuse.store.js';
import { MongoRateLimitStore } from './mongo-rate-limit.store.js';
import { MongoCooldownStore } from './mongo-cooldown.store.js';
import { MongoRecipientIndexStore } from './mongo-recipient-index.store.js';
import { MongoAuditSink } from './mongo-audit.sink.js';
import { runMongoMigrations, RunMigrationsOptions } from './migration-runner.js';

export interface CreateMongoStoresOptions extends RunMigrationsOptions {
  uri?: string;
  clientOptions?: MongoClientOptions;
  databaseName?: string;
  db?: Db;
}

export interface MongoStores {
  verify: MongoVerifyStore;
  abuse: MongoAbuseStore;
  rateLimit: MongoRateLimitStore;
  cooldown: MongoCooldownStore;
  recipientIndex: MongoRecipientIndexStore;
  /** @deprecated The same object as `recipientIndex`, under its pre-0.9.0 name; removed in 1.0. */
  phoneIndex: MongoRecipientIndexStore;
  audit: MongoAuditSink;
  /** Present only when the factory created its own MongoClient. Call close() on shutdown. */
  close?: () => Promise<void>;
}

/**
 * Construct all five Mongo stores against a shared Db and run pending
 * migrations (idempotent, sentinel-locked).
 *
 * @example
 * const stores = await createMongoStores({
 *   uri: process.env.MONGO_URI,
 *   databaseName: 'app',
 * });
 */
export async function createMongoStores(
  opts: CreateMongoStoresOptions,
): Promise<MongoStores> {
  let db: Db;
  let ownedClient: MongoClient | undefined;
  if (opts.db) {
    db = opts.db;
  } else if (opts.uri) {
    const client = new MongoClient(opts.uri, opts.clientOptions);
    await client.connect();
    ownedClient = client;
    db = client.db(opts.databaseName);
  } else {
    throw new Error(
      'createMongoStores: provide either { uri, databaseName? } or { db }',
    );
  }

  await runMongoMigrations(db, { skipSchemaSetup: opts.skipSchemaSetup });

  const recipientIndex = new MongoRecipientIndexStore({ db });
  const stores = {
    verify: new MongoVerifyStore({ db }),
    abuse: new MongoAbuseStore({ db }),
    rateLimit: new MongoRateLimitStore({ db }),
    cooldown: new MongoCooldownStore({ db }),
    recipientIndex,
    audit: new MongoAuditSink({ db }),
    close: ownedClient ? () => ownedClient!.close() : undefined,
  };
  // `phoneIndex`, the pre-0.9.0 name (#8), reads and writes `recipientIndex`,
  // so the two cannot disagree on this object, however it is changed. It is
  // not enumerable, so a spread such as `{ ...stores, recipientIndex: other }`
  // leaves it out. The type still lists it; on a spread copy it is undefined.
  return Object.defineProperty(stores, 'phoneIndex', {
    get: () => stores.recipientIndex,
    set: (store) => {
      stores.recipientIndex = store;
    },
    enumerable: false,
    configurable: true,
  }) as typeof stores & {
    phoneIndex: typeof recipientIndex;
  };
}
