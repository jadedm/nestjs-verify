import {
  ReserveResult,
  VerificationRecord,
  VerificationStatus,
  VerifyStore,
} from '../interfaces/verify-store.interface.js';

/**
 * Single-process in-memory store. Useful for dev/test only — data is lost on
 * restart, and atomicity holds only within the JS event loop. Do NOT use in
 * a multi-instance deployment.
 */
export class MemoryVerifyStore implements VerifyStore {
  private readonly records = new Map<string, VerificationRecord>();

  // Keeps core's deadline, set on this process's clock, the clock its checks
  // use; so it returns nothing (#108).
  async create(v: VerificationRecord, _ttlSeconds?: number): Promise<Date | void> {
    this.records.set(v.sid, { ...v });
  }

  async get(sid: string): Promise<VerificationRecord | null> {
    const r = this.records.get(sid);
    if (!r) return null;
    if (r.expiresAt.getTime() <= Date.now() && r.status === 'pending') {
      const expired: VerificationRecord = { ...r, status: 'expired' };
      this.records.set(sid, expired);
      return expired;
    }
    return { ...r };
  }

  /** Atomic within one process: no await between the read and the write. */
  async reserveAttempt(sid: string): Promise<ReserveResult> {
    const r = this.records.get(sid);
    if (!r) return { record: null, outcome: 'not-found' };
    if (r.status !== 'pending') return { record: { ...r }, outcome: 'not-pending' };
    if (r.expiresAt.getTime() <= Date.now()) return { record: { ...r }, outcome: 'expired' };
    if (r.attempts >= r.maxAttempts) return { record: { ...r }, outcome: 'exhausted' };
    const updated: VerificationRecord = { ...r, attempts: r.attempts + 1 };
    this.records.set(sid, updated);
    return { record: { ...updated }, outcome: 'reserved' };
  }

  async markStatus(
    sid: string,
    status: Exclude<VerificationStatus, 'pending'>,
  ): Promise<boolean> {
    const r = this.records.get(sid);
    if (!r || r.status !== 'pending') return false;
    this.records.set(sid, { ...r, status });
    return true;
  }

  async delete(sid: string): Promise<void> {
    this.records.delete(sid);
  }
}
