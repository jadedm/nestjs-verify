import { Db, MongoClient, MongoClientOptions } from 'mongodb';
import { MongoVerifyStore } from './mongo-verify.store.js';
import { MongoAbuseStore } from './mongo-abuse.store.js';
import { MongoRateLimitStore } from './mongo-rate-limit.store.js';
import { MongoCooldownStore } from './mongo-cooldown.store.js';
import { MongoPhoneIndexStore } from './mongo-phone-index.store.js';
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
  phoneIndex: MongoPhoneIndexStore;
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

  return {
    verify: new MongoVerifyStore({ db }),
    abuse: new MongoAbuseStore({ db }),
    rateLimit: new MongoRateLimitStore({ db }),
    cooldown: new MongoCooldownStore({ db }),
    phoneIndex: new MongoPhoneIndexStore({ db }),
    close: ownedClient ? () => ownedClient!.close() : undefined,
  };
}
