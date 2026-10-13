import type { PhoneIndexStore } from '@jadedm/nestjs-verify';
import { Collection, Db, MongoClient, MongoClientOptions } from 'mongodb';

export interface MongoRecipientIndexStoreOptions {
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
  /** The record's createdAt; absent on entries written before 0.9.0 (#82). */
  createdAt?: Date;
}

const MAX_SET_ATTEMPTS = 3;

// A filtered upsert that matched no document tries to insert one with this
// _id, and fails with a duplicate key on _id when a document exists.
const isDuplicateId = (err: unknown): boolean => {
  const { code, keyPattern } = (err ?? {}) as { code?: unknown; keyPattern?: Record<string, unknown> };
  return code === 11000 && keyPattern !== undefined && '_id' in keyPattern;
};

// Implements the pre-0.9.0 type name: the core range this adapter supports
// starts before `RecipientIndexStore` existed (#8).
export class MongoRecipientIndexStore implements PhoneIndexStore {
  private readonly col: Collection<PhoneIndexDoc>;
  private readonly ownedClient?: MongoClient;

  constructor(opts: MongoRecipientIndexStoreOptions) {
    let db: Db;
    if (opts.db) {
      db = opts.db;
    } else if (opts.uri) {
      const client = new MongoClient(opts.uri, opts.clientOptions);
      this.ownedClient = client;
      db = client.db(opts.databaseName);
    } else {
      throw new Error(
        'MongoRecipientIndexStore: provide either { uri, databaseName? } or { db }',
      );
    }
    this.col = db.collection<PhoneIndexDoc>(
      opts.collectionName ?? 'verify_phone_index',
    );
  }

  /**
   * With createdAt, one filtered upsert replaces the entry only when it has
   * expired, has no createdAt, or is no newer than this one; a live newer
   * entry is kept (#82). Without createdAt (a core before 0.9.0) it
   * overwrites, as before.
   */
  async set(phone: string, sid: string, ttlSeconds: number, createdAt?: Date): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    if (!createdAt) {
      await this.col.updateOne({ _id: phone }, { $set: { sid, expiresAt }, $unset: { createdAt: '' } }, { upsert: true });
      return;
    }
    const replaceable = {
      _id: phone,
      $or: [{ createdAt: { $exists: false } }, { createdAt: { $lte: createdAt } }, { expiresAt: { $lte: new Date() } }],
    };
    const update = { $set: { sid, expiresAt, createdAt } };
    // An upsert that loses an insert race gets a duplicate key on _id. The
    // document that won may be newer (keep it), older (replace it), or gone
    // again by now (insert after all); each further round needs yet another
    // writer, so the loop is short.
    for (let attempt = 1; ; attempt++) {
      if (await this.upsertIfReplaceable(replaceable, update)) return;
      const replaced = await this.col.updateOne(replaceable, update);
      if (replaced.matchedCount > 0) return;
      if (await this.col.findOne({ _id: phone }, { projection: { _id: 1 } })) return;
      if (attempt >= MAX_SET_ATTEMPTS) {
        throw new Error(`MongoRecipientIndexStore: the index entry was not written after ${attempt} attempts`);
      }
    }
  }

  // True when written; false when the insert lost to an existing document.
  private async upsertIfReplaceable(filter: object, update: object): Promise<boolean> {
    try {
      await this.col.updateOne(filter, update, { upsert: true });
      return true;
    } catch (err) {
      if (isDuplicateId(err)) return false;
      throw err;
    }
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

  async deleteIfMatches(phone: string, sid: string): Promise<void> {
    await this.col.deleteOne({ _id: phone, sid });
  }

  async close(): Promise<void> {
    await this.ownedClient?.close();
  }
}

/** @deprecated Renamed to `MongoRecipientIndexStore` in 0.9.0 (#8); removed in 1.0. */
export const MongoPhoneIndexStore = MongoRecipientIndexStore;
/** @deprecated Renamed to `MongoRecipientIndexStore` in 0.9.0 (#8); removed in 1.0. */
export type MongoPhoneIndexStore = MongoRecipientIndexStore;
/** @deprecated Renamed to `MongoRecipientIndexStoreOptions` in 0.9.0 (#8); removed in 1.0. */
export type MongoPhoneIndexStoreOptions = MongoRecipientIndexStoreOptions;
