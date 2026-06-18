import type { PhoneIndexStore } from '@jadedm/nestjs-verify';
import { Collection, Db, MongoClient, MongoClientOptions } from 'mongodb';

export interface MongoPhoneIndexStoreOptions {
  uri?: string;
  clientOptions?: MongoClientOptions;
  databaseName?: string;
  db?: Db;
  collectionName?: string;
}

interface PhoneIndexDoc {
  _id: string;
  sid: string;
  expiresAt: Date;
}

export class MongoPhoneIndexStore implements PhoneIndexStore {
  private readonly col: Collection<PhoneIndexDoc>;
  private readonly ownedClient?: MongoClient;

  constructor(opts: MongoPhoneIndexStoreOptions) {
    let db: Db;
    if (opts.db) {
      db = opts.db;
    } else if (opts.uri) {
      const client = new MongoClient(opts.uri, opts.clientOptions);
      this.ownedClient = client;
      db = client.db(opts.databaseName);
    } else {
      throw new Error(
        'MongoPhoneIndexStore: provide either { uri, databaseName? } or { db }',
      );
    }
    this.col = db.collection<PhoneIndexDoc>(
      opts.collectionName ?? 'verify_phone_index',
    );
  }

  async set(phone: string, sid: string, ttlSeconds: number): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    await this.col.updateOne(
      { _id: phone },
      { $set: { sid, expiresAt } },
      { upsert: true },
    );
  }

  async get(phone: string): Promise<string | null> {
    const doc = await this.col.findOne({ _id: phone });
    if (!doc) return null;
    if (doc.expiresAt.getTime() <= Date.now()) return null;
    return doc.sid;
  }

  async delete(phone: string): Promise<void> {
    await this.col.deleteOne({ _id: phone });
  }

  async close(): Promise<void> {
    await this.ownedClient?.close();
  }
}
