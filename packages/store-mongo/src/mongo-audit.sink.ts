import type { AuditEvent, AuditSink } from '@jadedm/nestjs-verify';
import { Collection, Db, MongoClient, MongoClientOptions } from 'mongodb';

export interface MongoAuditSinkOptions {
  uri?: string;
  clientOptions?: MongoClientOptions;
  databaseName?: string;
  db?: Db;
  collectionName?: string;
}

// The redacted recipient is stored as `phoneRedacted`, its name before 0.9.0 (#8).
interface AuditDoc extends Omit<AuditEvent, 'ts' | 'recipientRedacted' | 'phoneRedacted'> {
  phoneRedacted: string;
  ts: Date;
}

export class MongoAuditSink implements AuditSink {
  private readonly col: Collection<AuditDoc>;
  private readonly ownedClient?: MongoClient;

  constructor(opts: MongoAuditSinkOptions) {
    let db: Db;
    if (opts.db) {
      db = opts.db;
    } else if (opts.uri) {
      const client = new MongoClient(opts.uri, opts.clientOptions);
      this.ownedClient = client;
      db = client.db(opts.databaseName);
    } else {
      throw new Error(
        'MongoAuditSink: provide either { uri, databaseName? } or { db }',
      );
    }
    this.col = db.collection<AuditDoc>(
      opts.collectionName ?? 'verify_audit_log',
    );
  }

  async record(event: AuditEvent): Promise<void> {
    // One field, `phoneRedacted`, as before 0.9.0: core 0.9 sets both names
    // and a core before it sets only the old one (#8).
    const { recipientRedacted, phoneRedacted, ...rest } = event;
    await this.col.insertOne({
      ...rest,
      phoneRedacted: recipientRedacted ?? phoneRedacted,
      ts: event.ts,
    });
  }

  async close(): Promise<void> {
    await this.ownedClient?.close();
  }
}
