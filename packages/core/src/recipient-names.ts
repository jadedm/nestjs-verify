import type { Logger } from '@nestjs/common';
import type { AbuseStore } from './interfaces/abuse-store.interface.js';

// Options and store methods renamed from phone to recipient in 0.9.0 (#8).
// The old names keep working, with a warning, until 1.0.

/**
 * The value under the 0.9.0 name, or under its old name with a warning.
 * Both may be given only as the same value.
 */
// Two separately written but equal option objects count as one value.
const sameValue = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

export function pickRenamed<T>(
  log: Pick<Logger, 'warn'>,
  current: T | undefined,
  deprecated: T | undefined,
  [currentName, deprecatedName]: [string, string],
): T | undefined {
  if (current !== undefined && deprecated !== undefined && !sameValue(current, deprecated)) {
    throw new Error(`Set ${currentName} or ${deprecatedName}, not both: ${deprecatedName} is its name before 0.9.0 (#8).`);
  }
  if (current === undefined && deprecated !== undefined) {
    log.warn(`${deprecatedName} is deprecated; use ${currentName}. The old name is removed in 1.0.`);
  }
  return current ?? deprecated;
}

/**
 * The recipient index store. On a `create*Stores` result `phoneIndex` is a
 * non-enumerable accessor for `recipientIndex`, so the two cannot differ there,
 * and a spread leaves `phoneIndex` out. They differ only when `phoneIndex` was
 * written into another object, as a 0.8 setup does with
 * `{ ...stores, phoneIndex: other }`, or when both are written by hand; the
 * explicitly written old name is used, with a warning.
 */
export function pickIndexStore<T>(log: Pick<Logger, 'warn'>, recipientIndex: T | undefined, phoneIndex: T | undefined): T | undefined {
  if (phoneIndex === undefined || phoneIndex === recipientIndex) return recipientIndex;
  if (recipientIndex === undefined) {
    log.warn('stores.phoneIndex is deprecated; use stores.recipientIndex. The old name is removed in 1.0.');
    return phoneIndex;
  }
  log.warn(
    'stores.phoneIndex and stores.recipientIndex name different stores; using stores.phoneIndex, which was set by name. ' +
      'It is deprecated: rename it to stores.recipientIndex. The old name is removed in 1.0.',
  );
  return phoneIndex;
}

export type DistinctRecipientCounter = (ip: string, windowMs: number) => Promise<number>;

/** The abuse store's distinct-recipient count, under its 0.9.0 name or its old one. */
export function distinctRecipientCounter(
  log: Pick<Logger, 'warn'>,
  abuse: AbuseStore | undefined,
): DistinctRecipientCounter | undefined {
  if (!abuse) return undefined;
  if (typeof abuse.countDistinctRecipientsByIp === 'function') return abuse.countDistinctRecipientsByIp.bind(abuse);
  if (typeof abuse.countDistinctPhonesByIp !== 'function') {
    throw new Error('stores.abuse must implement countDistinctRecipientsByIp (#8).');
  }
  log.warn('stores.abuse.countDistinctPhonesByIp is deprecated; implement countDistinctRecipientsByIp. The old name is removed in 1.0.');
  return abuse.countDistinctPhonesByIp.bind(abuse);
}
