import type { VerifyModuleOptions } from './interfaces/module-options.interface.js';

// Option names renamed in 0.9.0 (#8) and removed in 1.0 (#124). A config that
// still sets one would otherwise be ignored quietly: a removed rate-limit name
// would leave the default limit in force. They are refused at boot, naming the
// new name, until 2.0.
const REMOVED: Array<{ name: string; replacement: string; owner: (o: VerifyModuleOptions) => unknown; key: string }> = [
  { name: 'stores.phoneIndex', replacement: 'stores.recipientIndex', owner: (o) => o.stores, key: 'phoneIndex' },
  { name: 'rateLimit.perPhone', replacement: 'rateLimit.perRecipient', owner: (o) => o.rateLimit, key: 'perPhone' },
  { name: 'abuse.maxDistinctPhonesPerIp', replacement: 'abuse.maxDistinctRecipientsPerIp', owner: (o) => o.abuse, key: 'maxDistinctPhonesPerIp' },
];

// Only a name the config itself sets: a 0.9 create*Stores result carries
// phoneIndex as a hidden getter, which the user did not write.
const setsOwn = (owner: unknown, key: string): boolean =>
  typeof owner === 'object' && owner !== null && Object.prototype.propertyIsEnumerable.call(owner, key);

export function refuseRemovedNames(options: VerifyModuleOptions): void {
  const used = REMOVED.filter(({ owner, key }) => setsOwn(owner(options), key));
  if (used.length === 0) return;
  throw new Error(
    `Option names removed in 1.0: ${used.map(({ name, replacement }) => `${name} (use ${replacement})`).join(', ')}.`,
  );
}
