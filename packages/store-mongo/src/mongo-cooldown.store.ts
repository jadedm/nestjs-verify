import type { CooldownStore } from '@jadedm/nestjs-verify';
import { Collection, Db, MongoClient, MongoClientOptions } from 'mongodb';

export interface MongoCooldownStoreOptions {
  uri?: string;
  clientOptions?: MongoClientOptions;
  databaseName?: string;
  db?: Db;
  collectionName?: string;
}

interface CooldownDoc {
  _id: string;
  expiresAt: Date;
}

export class MongoCooldownStore implements CooldownStore {
  private readonly col: Collection<CooldownDoc>;
  private readonly ownedClient?: MongoClient;

  constructor(opts: MongoCooldownStoreOptions) {
    let db: Db;
    if (opts.db) {
      db = opts.db;
    } else if (opts.uri) {
      const client = new MongoClient(opts.uri, opts.clientOptions);
      this.ownedClient = client;
      db = client.db(opts.databaseName);
    } else {
      throw new Error(
        'MongoCooldownStore: provide either { uri, databaseName? } or { db }',
      );
    }
    this.col = db.collection<CooldownDoc>(
      opts.collectionName ?? 'verify_cooldowns',
    );
  }

  async remaining(key: string): Promise<number> {
    const doc = await this.col.findOne({ _id: key });
    if (!doc) return 0;
    const ms = doc.expiresAt.getTime() - Date.now();
    return Math.max(0, ms);
  }

  async start(key: string, seconds: number): Promise<void> {
    const expiresAt = new Date(Date.now() + seconds * 1000);
    await this.col.updateOne(
      { _id: key },
      { $set: { expiresAt } },
      { upsert: true },
    );
  }

  async close(): Promise<void> {
    await this.ownedClient?.close();
  }
}
